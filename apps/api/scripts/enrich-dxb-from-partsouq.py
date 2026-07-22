#!/usr/bin/env python3
"""
Enrich DXB-EXW OEM listings with:
  1) PartSouq image CDN URLs (direct asset probe — no Cloudflare HTML)
  2) Vehicle compatibility from febest.de OEM reverse lookup when available
     (and/or copy from existing FEBEST OEM_CROSS_REFERENCE matches in DB)

Image binaries are never downloaded into app storage — only remote URLs are saved.

Usage:
  DXB_LIMIT=20 /tmp/oem-venv/bin/python apps/api/scripts/enrich-dxb-from-partsouq.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    import psycopg
    from psycopg.types.json import Jsonb
except ImportError as exc:  # pragma: no cover
    raise SystemExit("psycopg is required: pip install 'psycopg[binary]'") from exc

SOURCE_FILE = os.environ.get("DXB_SOURCE_FILE", "DXB-EXW.xlsx")
PART_WORKERS = max(1, int(os.environ.get("DXB_WORKERS", "6")))
DELAY_MS = int(os.environ.get("DXB_DELAY_MS", "0"))
FEBEST_DELAY_MS = int(os.environ.get("DXB_FEBEST_DELAY_MS", "400"))
# FEBEST live OEM scrape is slow; default off for full-catalog image pass.
# Set DXB_FEBEST=1 to also scrape febest.de. DB FEBEST OEM cross-ref copy is always on.
ENABLE_FEBEST_LIVE = os.environ.get("DXB_FEBEST", "0") == "1"
LIMIT = int(os.environ["DXB_LIMIT"]) if os.environ.get("DXB_LIMIT") else None
FORCE = os.environ.get("DXB_FORCE") == "1"
STATE_PATH = Path(os.environ.get("DXB_STATE_PATH", "/tmp/dxb-oem-enrich-progress.json"))
OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL")
INDEX_NAME = os.environ.get("OPENSEARCH_INDEX", "canonical_parts")
USER_AGENT = (
    "PartsBazar360CatalogBot/1.0 (+https://partsbazar360.realtrackapp.com; catalog enrichment)"
)

# Known PartSouq placeholder thumbnails (wrong brand/pn still returns 200).
PLACEHOLDER_MD5 = {
    "05fa1c95ee34494447a753acf8567c3c",
    "5ede2cf0c55c4934b65833f903f376ae",
}

BRAND_FOLDERS: dict[str, list[str]] = {
    "MITSUBISHI": ["Mitsubishi"],
    "TOYOTA": ["Toyota"],
    "HONDA": ["Honda"],
    "SUBARU": ["Subaru"],
    "NISSAN": ["Nissan"],
    "MERCEDES BENZ": ["Mercedes-Benz", "Mercedes"],
    "MERCEDES-BENZ": ["Mercedes-Benz", "Mercedes"],
    "VAG": ["Volkswagen", "Audi", "VAG"],
    "MAZDA": ["Mazda"],
    "SUZUKI": ["Suzuki"],
    "BMW": ["BMW"],
    "RENAULT": ["Renault"],
    "PORSCHE": ["Porsche"],
    "LAND ROVER": ["Land-Rover", "LandRover"],
    "FORD": ["Ford"],
    "GENERAL MOTORS": ["Chevrolet", "GM", "Cadillac", "GMC"],
    "MOBIS": ["Hyundai", "Kia", "Hyundai-/-KIA"],
    "PEUGEOT/CITROEN": ["Peugeot", "Citroen"],
    "PEUGEOT": ["Peugeot"],
    "CITROEN": ["Citroen"],
    "GATES": ["Gates"],
    "DENSO": ["Denso"],
    "BOSCH": ["Bosch"],
    "NGK": ["NGK"],
}


def load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        data["done"] = set(data.get("done") or [])
        return data
    return {"done": set(), "ok": 0, "fail": 0, "skipped": 0, "notFound": 0, "errors": []}


def save_state(state: dict[str, Any]) -> None:
    payload = {
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ok": state["ok"],
        "fail": state["fail"],
        "skipped": state["skipped"],
        "notFound": state["notFound"],
        "done": sorted(state["done"]),
        "errors": (state.get("errors") or [])[-100:],
    }
    STATE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def brand_folders(brand: str | None) -> list[str]:
    key = (brand or "").strip().upper()
    if key in BRAND_FOLDERS:
        return BRAND_FOLDERS[key]
    if not key:
        return []
    titled = key.replace("/", "-").title().replace(" ", "-")
    return [titled, key.title(), key]


def pn_variants(pn: str) -> list[str]:
    raw = str(pn or "").strip()
    if not raw:
        return []
    alnum = re.sub(r"[^A-Za-z0-9]", "", raw)
    out = [raw, alnum]
    # Common OEM dash patterns: 48069-06150, 04152-YZZA1
    if len(alnum) >= 8 and "-" not in raw:
        out.append(f"{alnum[:5]}-{alnum[5:]}")
        out.append(f"{alnum[:4]}-{alnum[4:]}")
    return list(dict.fromkeys([x for x in out if x]))


def probe_image(url: str) -> str | None:
    # Prefer HEAD for speed; fall back to GET for size/placeholder checks.
    head_req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(head_req, timeout=12) as res:
            ctype = (res.headers.get("Content-Type") or "").lower()
            clen = int(res.headers.get("Content-Length") or "0")
            if "image/" not in ctype:
                return None
            if clen and clen < 500:
                return None
            # jpeg/png with decent size is almost always a real asset on this CDN
            if clen >= 1000 and ("jpeg" in ctype or "jpg" in ctype or clen >= 5000):
                return url
    except Exception:  # noqa: BLE001
        pass

    req = urllib.request.Request(url, method="GET", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            data = res.read(256_000)
            ctype = (res.headers.get("Content-Type") or "").lower()
            if "image/" not in ctype:
                return None
            if len(data) < 500:
                return None
            full = hashlib.md5(data).hexdigest()
            if full in PLACEHOLDER_MD5:
                return None
            return url
    except Exception:  # noqa: BLE001
        return None


def discover_partsouq_images(brand: str | None, pn: str) -> list[str]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    folders = brand_folders(brand)[:1]  # primary folder only — wrong brands are placeholders
    variants = pn_variants(pn)[:2]
    candidates: list[str] = []
    for folder in folders:
        for variant in variants:
            candidates.append(
                f"https://partsouq.com/assets/PartThumbnail/assets/partsimages/{quote(folder)}/{quote(variant)}.jpg"
            )
            candidates.append(
                f"https://partsouq.com/assets/PartThumbnail/assets/partsimages/{quote(folder)}/{quote(variant)}-0.jpg"
            )

    found: list[str] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(probe_image, url) for url in candidates]
        for fut in as_completed(futures):
            hit = fut.result()
            if hit and hit not in found:
                found.append(hit)
    return found[:8]


def fetch_text(url: str) -> str | None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html", "Accept-Language": "en"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.read().decode("utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        return None


def parse_febest_models(html: str) -> list[str]:
    block = re.search(r'id="model_list"[^>]*>([\s\S]*?)</select>', html, re.I)
    if not block:
        return []
    return list(
        dict.fromkeys(
            m.group(1).strip()
            for m in re.finditer(r'<option[^>]*value="([^"]*)"[^>]*>', block.group(1), re.I)
            if m.group(1).strip()
        )
    )


def parse_febest_images(html: str) -> list[str]:
    urls = re.findall(r"https://static\.febest\.de/images/[^\"'>\s]+", html, re.I)
    urls = [u.replace("&amp;", "&") for u in urls]
    big = [u for u in urls if "/images/big/" in u.lower()]
    rest = [u for u in urls if u not in big]
    return list(dict.fromkeys([*big, *rest]))[:12]


def parse_model_line(raw: str) -> dict[str, Any]:
    m = re.match(
        r"^(\S+)\s+(.+?)\s+(\d{4})(?:\.(\d{2}))?\s*-\s*(?:(\d{4})(?:\.(\d{2}))?)?\s*\[([^\]]+)\]\s*$",
        raw,
    )
    if not m:
        return {"make": None, "model": raw, "startYear": None, "endYear": None, "market": None, "raw": raw}
    start = int(m.group(3))
    end = int(m.group(5)) if m.group(5) else time.gmtime().tm_year
    return {
        "make": m.group(1),
        "model": m.group(2).strip(),
        "startYear": start,
        "endYear": max(end, start),
        "market": m.group(7),
        "raw": raw,
    }


def build_compat_from_febest(models: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    current = time.gmtime().tm_year
    # Large model lists explode into tens of thousands of year rows — keep model-level
    # rows without year expansion when the catalog returns a huge set.
    expand_years = len(models) <= 25
    for raw in models:
        parsed = parse_model_line(raw)
        if not expand_years or not parsed["make"] or not parsed["startYear"]:
            rows.append(
                {
                    "year": "-",
                    "make": parsed["make"] or "-",
                    "model": parsed["model"] or raw,
                    "trim": "-",
                    "engine": "-",
                    "source": "febest.de",
                    "raw": raw,
                }
            )
            continue
        start = parsed["startYear"]
        end = min(parsed["endYear"] or current, start + 40)
        for year in range(start, end + 1):
            rows.append(
                {
                    "year": year,
                    "make": parsed["make"],
                    "model": parsed["model"],
                    "trim": "-",
                    "engine": "-",
                    "source": "febest.de",
                    "market": parsed["market"],
                    "raw": raw,
                }
            )
    return rows[:500]


def febest_oem_lookup(pn: str) -> dict[str, Any]:
    catalog_url = f"https://febest.de/en/catalog?oem={quote(pn)}&search_type=oem"
    html = fetch_text(catalog_url)
    time.sleep(FEBEST_DELAY_MS / 1000.0)
    if not html:
        return {"ok": False, "imageUrls": [], "compatibility": [], "detailsUrl": None}
    details = re.findall(r'href="(/en/details/[^"]+)"', html, re.I)
    if not details:
        return {"ok": False, "imageUrls": [], "compatibility": [], "detailsUrl": None}
    details_url = f"https://febest.de{details[0]}"
    details_html = fetch_text(details_url)
    time.sleep(FEBEST_DELAY_MS / 1000.0)
    if not details_html:
        return {"ok": False, "imageUrls": [], "compatibility": [], "detailsUrl": details_url}
    models = parse_febest_models(details_html)
    images = parse_febest_images(details_html)
    return {
        "ok": bool(images or models),
        "imageUrls": images,
        "compatibility": build_compat_from_febest(models),
        "detailsUrl": details_url,
        "models": models,
    }


def opensearch_index(part: dict[str, Any]) -> None:
    if not OPENSEARCH_URL:
        return
    body = {
        "id": part["id"],
        "title": part["title"],
        "brand": part.get("brand"),
        "manufacturerPartNumber": part.get("manufacturerPartNumber"),
        "imageUrls": part.get("imageUrls") or [],
        "listingUrl": part.get("listingUrl"),
        "compatibility": part.get("compatibility"),
        "oeNumbers": part.get("oeNumbers") or [],
        "fitmentStatus": part.get("fitmentStatus"),
    }
    req = urllib.request.Request(
        f"{OPENSEARCH_URL.rstrip('/')}/{INDEX_NAME}/_doc/{part['id']}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            res.read()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"event": "opensearch_warn", "id": part["id"], "error": str(exc)}), flush=True)


def main() -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")

    state = load_state()
    print(
        json.dumps(
            {
                "event": "start",
                "sourceFile": SOURCE_FILE,
                "delayMs": DELAY_MS,
                "febestDelayMs": FEBEST_DELAY_MS,
                "febestLive": ENABLE_FEBEST_LIVE,
                "workers": PART_WORKERS,
                "limit": LIMIT,
                "force": FORCE,
                "alreadyDone": len(state["done"]),
                "statePath": str(STATE_PATH),
            }
        ),
        flush=True,
    )

    with psycopg.connect(database_url) as conn:
        # Preload FEBEST OEM → compatibility/images for instant DB copy (no HTTP).
        febest_by_oem: dict[str, dict[str, Any]] = {}
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pn."normalizedNumber", c."imageUrls", c.compatibility, c."listingUrl"
                FROM "CatalogPartNumber" pn
                JOIN "CanonicalPart" c ON c.id = pn."canonicalPartId"
                WHERE pn."numberType" = 'OEM_CROSS_REFERENCE'
                  AND (
                    cardinality(c."imageUrls") > 0
                    OR (c.compatibility IS NOT NULL AND c.compatibility::text NOT IN ('null', '[]'))
                  )
                """
            )
            for norm, imgs, compat, listing in cur.fetchall():
                if not norm:
                    continue
                key = str(norm)
                existing = febest_by_oem.get(key)
                imgs = list(imgs or [])
                compat = compat if isinstance(compat, list) else []
                if not existing:
                    febest_by_oem[key] = {
                        "imageUrls": imgs,
                        "compatibility": compat,
                        "listingUrl": listing,
                    }
                else:
                    if len(imgs) > len(existing["imageUrls"]):
                        existing["imageUrls"] = imgs
                    if len(compat) > len(existing["compatibility"]):
                        existing["compatibility"] = compat
        print(json.dumps({"event": "loaded_febest_oem_index", "count": len(febest_by_oem)}), flush=True)

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT c.id, c.title, c.brand, c."manufacturerPartNumber",
                       c."imageUrls", c."listingUrl", c."oeNumbers", c."fitmentFlags",
                       c.compatibility, pn."displayNumber"
                FROM "SourceRecord" sr
                JOIN "SellerOffer" o ON o.id = sr."sellerOfferId"
                JOIN "CanonicalPart" c ON c.id = o."canonicalPartId"
                LEFT JOIN "CatalogPartNumber" pn
                  ON pn."canonicalPartId" = c.id AND pn."numberType" = 'BRAND_MPN'
                WHERE sr."sourceFileName" = %s
                ORDER BY c.brand NULLS LAST, pn."displayNumber" NULLS LAST
                """,
                (SOURCE_FILE,),
            )
            rows = cur.fetchall()

        print(json.dumps({"event": "loaded_dxb_parts", "count": len(rows)}), flush=True)

        processed = 0
        for row in rows:
            (
                part_id,
                title,
                brand,
                mpn,
                image_urls,
                listing_url,
                oe_numbers,
                fitment_flags,
                compatibility,
                display_number,
            ) = row
            pn = mpn or display_number
            if not FORCE and part_id in state["done"]:
                continue
            if LIMIT is not None and processed >= LIMIT:
                break
            processed += 1

            image_urls = list(image_urls or [])
            oe_numbers = list(oe_numbers or [])
            fitment_flags = list(fitment_flags or [])

            has_images = any(
                ("partsouq.com" in str(u)) or ("static.febest.de" in str(u)) for u in image_urls
            )
            has_compat = isinstance(compatibility, list) and len(compatibility) > 0
            # Full-catalog pass prioritizes images; don't block on missing compat.
            if not FORCE and has_images and (has_compat or not ENABLE_FEBEST_LIVE):
                state["skipped"] += 1
                state["done"].add(part_id)
                continue
            if not pn:
                state["skipped"] += 1
                state["done"].add(part_id)
                continue

            try:
                partsouq_images = discover_partsouq_images(brand, str(pn))
                if DELAY_MS:
                    time.sleep(DELAY_MS / 1000.0)

                norm_pn = re.sub(r"[^A-Z0-9]", "", str(pn).upper())
                db_hit = febest_by_oem.get(norm_pn) or {}

                febest = {"ok": False, "imageUrls": [], "compatibility": [], "detailsUrl": None}
                if ENABLE_FEBEST_LIVE and (not has_compat or FORCE):
                    febest = febest_oem_lookup(str(pn))

                merged_images = list(
                    dict.fromkeys(
                        [
                            *partsouq_images,
                            *(db_hit.get("imageUrls") or []),
                            *(febest.get("imageUrls") or []),
                            *image_urls,
                        ]
                    )
                )[:20]
                compat_rows = (
                    febest.get("compatibility")
                    or db_hit.get("compatibility")
                    or (compatibility if isinstance(compatibility, list) else [])
                    or []
                )

                listing = listing_url
                if partsouq_images:
                    listing = f"https://partsouq.com/en/search/all?q={quote(str(pn))}"
                elif febest.get("detailsUrl"):
                    listing = febest["detailsUrl"]
                elif db_hit.get("listingUrl"):
                    listing = db_hit["listingUrl"]

                if not merged_images and not compat_rows:
                    state["notFound"] += 1
                    state["done"].add(part_id)
                    state["errors"].append({"id": part_id, "pn": pn, "error": "no_images_or_compat"})
                    if state["notFound"] <= 30 or state["notFound"] % 200 == 0:
                        print(json.dumps({"event": "part", "id": part_id, "pn": pn, "brand": brand, "status": "not_found"}), flush=True)
                    continue

                flags = list(dict.fromkeys([*fitment_flags]))
                if partsouq_images:
                    flags.append("PARTSOUQ_IMAGE_CDN")
                if db_hit:
                    flags.append("FEBEST_DB_OEM_MATCH")
                if febest.get("ok"):
                    flags.append("FEBEST_OEM_LOOKUP")

                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE "CanonicalPart"
                        SET "imageUrls" = %s,
                            "listingUrl" = %s,
                            "oeNumbers" = %s,
                            compatibility = %s,
                            "fitmentStatus" = 'NOT_VERIFIED',
                            "fitmentFlags" = %s,
                            "updatedAt" = NOW()
                        WHERE id = %s
                        """,
                        (
                            merged_images,
                            listing,
                            list(dict.fromkeys([*oe_numbers, str(pn)])),
                            Jsonb(compat_rows if compat_rows else []),
                            list(dict.fromkeys(flags)),
                            part_id,
                        ),
                    )
                    for i, url in enumerate(merged_images[:12]):
                        cur.execute(
                            """
                            INSERT INTO "ProductMedia"
                              (id, "canonicalPartId", url, "normalizedUrl", "sourceUrl", "sortOrder",
                               "isPrimary", "mediaType", "importStatus", "altText", "createdAt")
                            VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, 'IMAGE', 'IMPORTED', %s, NOW())
                            ON CONFLICT ("canonicalPartId", "normalizedUrl") DO UPDATE
                              SET url = EXCLUDED.url,
                                  "sourceUrl" = EXCLUDED."sourceUrl",
                                  "sortOrder" = EXCLUDED."sortOrder",
                                  "isPrimary" = EXCLUDED."isPrimary",
                                  "altText" = EXCLUDED."altText"
                            """,
                            (part_id, url, url, listing, i, i == 0, title),
                        )
                conn.commit()

                opensearch_index(
                    {
                        "id": part_id,
                        "title": title,
                        "brand": brand,
                        "manufacturerPartNumber": mpn or pn,
                        "imageUrls": merged_images,
                        "listingUrl": listing,
                        "compatibility": compat_rows,
                        "oeNumbers": list(dict.fromkeys([*oe_numbers, str(pn)])),
                        "fitmentStatus": "NOT_VERIFIED",
                    }
                )

                state["ok"] += 1
                state["done"].add(part_id)
                if state["ok"] <= 50 or state["ok"] % 50 == 0:
                    print(
                        json.dumps(
                            {
                                "event": "part",
                                "id": part_id,
                                "pn": pn,
                                "brand": brand,
                                "status": "ok",
                                "partsouqImages": len(partsouq_images),
                                "dbFebestImages": len(db_hit.get("imageUrls") or []),
                                "febestImages": len(febest.get("imageUrls") or []),
                                "compatRows": len(compat_rows),
                                "progressOk": state["ok"],
                                "progressDone": len(state["done"]),
                            }
                        ),
                        flush=True,
                    )
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                state["fail"] += 1
                state["done"].add(part_id)
                state["errors"].append({"id": part_id, "pn": pn, "error": str(exc)})
                print(json.dumps({"event": "part", "id": part_id, "pn": pn, "status": "fail", "error": str(exc)}), flush=True)

            if (state["ok"] + state["fail"] + state["notFound"] + state["skipped"]) % 20 == 0:
                save_state(state)

    save_state(state)
    print(
        json.dumps(
            {
                "event": "done",
                "ok": state["ok"],
                "fail": state["fail"],
                "skipped": state["skipped"],
                "notFound": state["notFound"],
                "done": len(state["done"]),
                "statePath": str(STATE_PATH),
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
