#!/usr/bin/env python3
"""
DXB enrichment via PartSouq HTML (browser/FlareSolverr).

Fetches search pages through FlareSolverr (Cloudflare challenge solver),
parses image URLs + model compatibility, writes CanonicalPart + ProductMedia,
and reindexes OpenSearch with full offers.

Requires:
  - FlareSolverr on http://127.0.0.1:8191
  - pip: beautifulsoup4 lxml psycopg[binary]

Usage:
  DXB_LIMIT=20 /tmp/oem-venv/bin/python apps/api/scripts/enrich-dxb-partsouq-browser.py
  DXB_LIMIT=all DXB_FORCE=1 ...   # re-scrape everything
  DXB_ONLY_MISSING=1 ...          # only parts missing images or compat (default)
"""
from __future__ import annotations

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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from partsouq_fetch import parse_search_html  # noqa: E402

try:
    import psycopg
    from psycopg.types.json import Jsonb
except ImportError as exc:  # pragma: no cover
    raise SystemExit("psycopg required") from exc

FLARESOLVERR = os.environ.get("FLARESOLVERR_URL", "http://127.0.0.1:8191/v1")
SOURCE_FILE = os.environ.get("DXB_SOURCE_FILE", "DXB-EXW.xlsx")
LIMIT = None if not os.environ.get("DXB_LIMIT") or os.environ.get("DXB_LIMIT") in ("all", "0") else int(os.environ["DXB_LIMIT"])
FORCE = os.environ.get("DXB_FORCE") == "1"
ONLY_MISSING = os.environ.get("DXB_ONLY_MISSING", "1") == "1"
DELAY_MS = int(os.environ.get("DXB_DELAY_MS", "800"))
STATE_PATH = Path(os.environ.get("DXB_STATE_PATH", "/tmp/dxb-partsouq-browser-progress.json"))
OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL", "").rstrip("/")
INDEX_NAME = os.environ.get("OPENSEARCH_INDEX", "canonical_parts")
DATABASE_URL = os.environ.get("DATABASE_URL")


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
        "sessionId": state.get("sessionId"),
    }
    STATE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def flare_request(payload: dict[str, Any], timeout: int = 130) -> dict[str, Any]:
    req = urllib.request.Request(
        FLARESOLVERR,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def ensure_session(state: dict[str, Any]) -> str:
    sid = state.get("sessionId")
    if sid:
        return sid
    data = flare_request({"cmd": "sessions.create"}, timeout=60)
    if data.get("status") != "ok":
        raise RuntimeError(f"sessions.create failed: {data}")
    sid = data["session"]
    state["sessionId"] = sid
    save_state(state)
    print(json.dumps({"event": "session_created", "sessionId": sid}), flush=True)
    return sid


def fetch_partsouq_html(pn: str, session_id: str) -> dict[str, Any]:
    url = f"https://partsouq.com/en/search/all?q={quote(str(pn))}"
    data = flare_request(
        {
            "cmd": "request.get",
            "url": url,
            "session": session_id,
            "maxTimeout": 120000,
        },
        timeout=140,
    )
    if data.get("status") != "ok":
        return {"ok": False, "error": data.get("message") or "flare_failed", "html": ""}
    sol = data.get("solution") or {}
    html = sol.get("response") or ""
    if "Just a moment" in html or "security verification" in html.lower():
        return {"ok": False, "error": "cloudflare_blocked", "html": html}
    return {"ok": True, "html": html, "url": sol.get("url") or url}


def build_compat(models: list[str], make: str | None) -> list[dict[str, Any]]:
    make_name = (make or "-").strip() or "-"
    rows = []
    for raw in models or []:
        model = str(raw).strip()
        if not model:
            continue
        # Expand "L200/L200,Triton,Strada"
        for piece in re.split(r"[,/]", model):
            m = piece.strip()
            if not m:
                continue
            rows.append(
                {
                    "year": "-",
                    "make": make_name,
                    "model": m,
                    "trim": "-",
                    "engine": "-",
                    "source": "partsouq.com",
                    "raw": model,
                }
            )
    # Dedupe
    seen = set()
    out = []
    for r in rows:
        key = (r["make"], r["model"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out[:80]


def prefer_images(urls: list[str], pn: str) -> list[str]:
    pn_n = re.sub(r"[^A-Z0-9]", "", pn.upper())
    ranked = sorted(
        dict.fromkeys(urls),
        key=lambda u: (
            0 if pn_n and pn_n in re.sub(r"[^A-Z0-9]", "", u.upper()) and "partsimages" in u else 1,
            0 if "partsimages" in u else 1,
            0 if u.lower().endswith((".jpg", ".jpeg")) else 1,
            u,
        ),
    )
    # Drop tiny cover placeholders if we have real partsimages
    has_real = any("partsimages" in u for u in ranked)
    if has_real:
        ranked = [u for u in ranked if "partsimages" in u or "PartThumbnail" in u]
    return ranked[:12]


def reindex_part(conn, part_id: str) -> None:
    if not OPENSEARCH_URL:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.title, c.brand, c."manufacturerPartNumber", c.category, c."partType",
                   c."imageUrls", c."listingUrl", c."oeNumbers", c.compatibility,
                   c."partSource", c."qualityTier", c."fitmentStatus", c."fitmentConfidence", c."createdAt"
            FROM "CanonicalPart" c WHERE c.id = %s
            """,
            (part_id,),
        )
        row = cur.fetchone()
        if not row:
            return
        cur.execute(
            """
            SELECT o.id, o.price, o.currency, o.condition, o."partSource", o."qualityTier",
                   o."sellerId", o.status, s.name
            FROM "SellerOffer" o JOIN "Seller" s ON s.id=o."sellerId"
            WHERE o."canonicalPartId" = %s
            """,
            (part_id,),
        )
        offers = [
            {
                "id": r[0],
                "price": r[1],
                "currency": r[2],
                "condition": r[3],
                "partSource": r[4],
                "qualityTier": r[5],
                "sellerId": r[6],
                "status": r[7],
                "sellerName": r[8],
            }
            for r in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT "displayNumber", "normalizedNumber", "numberType"
            FROM "CatalogPartNumber" WHERE "canonicalPartId" = %s
            """,
            (part_id,),
        )
        part_numbers = [
            {"displayNumber": r[0], "normalizedNumber": r[1], "numberType": r[2]} for r in cur.fetchall()
        ]

    (
        _id,
        title,
        brand,
        mpn,
        category,
        part_type,
        image_urls,
        listing_url,
        oe_numbers,
        compatibility,
        part_source,
        quality_tier,
        fitment_status,
        fitment_confidence,
        created_at,
    ) = row
    prices = [o["price"] for o in offers if o.get("price") is not None]
    body = {
        "id": part_id,
        "title": title,
        "brand": brand,
        "manufacturerPartNumber": mpn,
        "category": category,
        "partType": part_type,
        "imageUrls": list(image_urls or []),
        "listingUrl": listing_url,
        "oeNumbers": list(oe_numbers or []),
        "compatibility": compatibility,
        "partSource": part_source,
        "qualityTier": quality_tier,
        "fitmentStatus": fitment_status,
        "fitmentConfidence": fitment_confidence,
        "createdAt": created_at.isoformat() if created_at else None,
        "minPrice": min(prices) if prices else None,
        "normalizedPartNumbers": [
            n["normalizedNumber"]
            for n in part_numbers
            if n["numberType"] != "OEM_CROSS_REFERENCE" and n.get("normalizedNumber")
        ],
        "interchangePartNumbers": [
            n["normalizedNumber"]
            for n in part_numbers
            if n["numberType"] == "OEM_CROSS_REFERENCE" and n.get("normalizedNumber")
        ],
        "partNumbers": part_numbers,
        "fitments": [],
        "offers": offers,
    }
    req = urllib.request.Request(
        f"{OPENSEARCH_URL}/{INDEX_NAME}/_doc/{part_id}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            res.read()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"event": "opensearch_warn", "id": part_id, "error": str(exc)}), flush=True)


def main() -> int:
    if not DATABASE_URL:
        raise SystemExit("DATABASE_URL required")

    state = load_state()
    session_id = ensure_session(state)

    print(
        json.dumps(
            {
                "event": "start",
                "limit": LIMIT,
                "force": FORCE,
                "onlyMissing": ONLY_MISSING,
                "delayMs": DELAY_MS,
                "alreadyDone": len(state["done"]),
                "flaresolverr": FLARESOLVERR,
            }
        ),
        flush=True,
    )

    with psycopg.connect(DATABASE_URL) as conn:
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

            image_urls = list(image_urls or [])
            oe_numbers = list(oe_numbers or [])
            fitment_flags = list(fitment_flags or [])
            has_ps_image = any("partsouq.com" in str(u) for u in image_urls)
            has_ps_compat = isinstance(compatibility, list) and any(
                isinstance(r, dict) and r.get("source") == "partsouq.com" for r in compatibility
            )
            if ONLY_MISSING and not FORCE and has_ps_image and has_ps_compat:
                state["skipped"] += 1
                state["done"].add(part_id)
                continue
            if not pn:
                state["skipped"] += 1
                state["done"].add(part_id)
                continue

            processed += 1
            try:
                fetched = fetch_partsouq_html(str(pn), session_id)
                if not fetched.get("ok"):
                    # Recreate session once on CF failure
                    if fetched.get("error") == "cloudflare_blocked":
                        try:
                            flare_request({"cmd": "sessions.destroy", "session": session_id}, timeout=30)
                        except Exception:
                            pass
                        state["sessionId"] = None
                        session_id = ensure_session(state)
                        fetched = fetch_partsouq_html(str(pn), session_id)
                if not fetched.get("ok"):
                    state["notFound"] += 1
                    state["done"].add(part_id)
                    state["errors"].append({"id": part_id, "pn": pn, "error": fetched.get("error")})
                    print(json.dumps({"event": "part", "id": part_id, "pn": pn, "status": "not_found", "error": fetched.get("error")}), flush=True)
                    time.sleep(DELAY_MS / 1000.0)
                    continue

                parsed = parse_search_html(fetched["html"], str(pn), brand)
                images = prefer_images(parsed.get("imageUrls") or [], str(pn))
                compat = build_compat(parsed.get("models") or [], parsed.get("make") or brand)
                if not images and not compat:
                    state["notFound"] += 1
                    state["done"].add(part_id)
                    print(json.dumps({"event": "part", "id": part_id, "pn": pn, "brand": brand, "status": "empty_parse"}), flush=True)
                    time.sleep(DELAY_MS / 1000.0)
                    continue

                # Prefer freshly scraped PartSouq PN images first.
                merged_images = list(dict.fromkeys([*images, *image_urls]))[:20]
                # Only overwrite compatibility when PartSouq returned models.
                existing_compat = compatibility if isinstance(compatibility, list) else []
                compat_rows = compat if compat else existing_compat
                listing = fetched.get("url") or f"https://partsouq.com/en/search/all?q={quote(str(pn))}"
                next_title = title
                parsed_title = (parsed.get("title") or "").strip()
                if (
                    parsed_title
                    and parsed_title.lower() not in ("chat", "search")
                    and (not title or "Part –" in title or "Part -" in title or title.strip().lower() == "chat")
                ):
                    next_title = f"{brand or parsed.get('make') or 'OEM'} {parsed_title}".strip()

                flags = list(dict.fromkeys([*(fitment_flags or []), "PARTSOUQ_BROWSER"]))

                with conn.cursor() as cur:
                    if compat:
                        cur.execute(
                            """
                            UPDATE "CanonicalPart"
                            SET title = %s,
                                "imageUrls" = %s,
                                "listingUrl" = %s,
                                "oeNumbers" = %s,
                                compatibility = %s,
                                "fitmentStatus" = 'NOT_VERIFIED',
                                "fitmentFlags" = %s,
                                "updatedAt" = NOW()
                            WHERE id = %s
                            """,
                            (
                                next_title,
                                merged_images,
                                listing,
                                list(dict.fromkeys([*oe_numbers, str(pn)])),
                                Jsonb(compat_rows),
                                flags,
                                part_id,
                            ),
                        )
                    else:
                        cur.execute(
                            """
                            UPDATE "CanonicalPart"
                            SET title = %s,
                                "imageUrls" = %s,
                                "listingUrl" = %s,
                                "oeNumbers" = %s,
                                "fitmentFlags" = %s,
                                "updatedAt" = NOW()
                            WHERE id = %s
                            """,
                            (
                                next_title,
                                merged_images,
                                listing,
                                list(dict.fromkeys([*oe_numbers, str(pn)])),
                                flags,
                                part_id,
                            ),
                        )
                    for i, url in enumerate(images[:12]):
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
                            (part_id, url, url, listing, i, i == 0, next_title),
                        )
                conn.commit()
                reindex_part(conn, part_id)

                state["ok"] += 1
                state["done"].add(part_id)
                print(
                    json.dumps(
                        {
                            "event": "part",
                            "id": part_id,
                            "pn": pn,
                            "brand": brand,
                            "status": "ok",
                            "images": len(images),
                            "models": len(parsed.get("models") or []),
                            "compatRows": len(compat_rows),
                            "title": parsed.get("title"),
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

            if (state["ok"] + state["fail"] + state["notFound"]) % 10 == 0:
                save_state(state)
            time.sleep(DELAY_MS / 1000.0)

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
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
