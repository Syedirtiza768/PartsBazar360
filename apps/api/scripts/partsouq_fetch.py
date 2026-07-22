#!/usr/bin/env python3
"""
Fetch OEM part image URLs + model compatibility from PartSouq.

Usage:
  partsouq_fetch.py --pn 1230A153 [--brand MITSUBISHI]
  partsouq_fetch.py --batch-jsonl -   # read {"pn","brand"?} lines from stdin

Requires: cloudscraper, beautifulsoup4, lxml
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from typing import Any
from urllib.parse import urljoin

BASE = "https://partsouq.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def normalize_pn(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def absolute_url(src: str) -> str:
    return urljoin(BASE, src.strip())


def create_scraper():
    import cloudscraper

    return cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )


def _add_models(models: list[str], raw: str) -> None:
    for piece in re.split(r"[,/]", raw):
        model = piece.strip().strip(".")
        if not model or model == "..." or len(model) > 80:
            continue
        if model.lower() in ("compatibility", "make", "add", "not available"):
            continue
        if model not in models:
            models.append(model)


def parse_search_html(html: str, pn: str, brand: str | None = None) -> dict[str, Any]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    pn_norm = normalize_pn(pn)
    pn_upper = str(pn or "").upper()

    images: list[str] = []
    for el in soup.find_all(["img", "a"]):
        candidates = [
            el.get("src"),
            el.get("data-src"),
            el.get("data-zoom-image"),
            el.get("href"),
        ]
        for src in candidates:
            if not src:
                continue
            if any(token in src for token in ("partsimages", "PartThumbnail", "PartCoverThumbnail", "/tesseract/")):
                images.append(absolute_url(src))

    # Prefer exact PN thumbnails; drop unrelated substitution covers when PN hits exist.
    def image_rank(url: str) -> tuple[int, str]:
        u = normalize_pn(url)
        if pn_norm and pn_norm in u and "partsimages" in url:
            return (0, url)
        if pn_norm and pn_norm in u and "tesseract" in url:
            return (1, url)
        if pn_norm and pn_norm in u:
            return (2, url)
        if "partsimages" in url:
            return (3, url)
        return (4, url)

    ranked = [u for u, _ in sorted({u: image_rank(u) for u in images}.items(), key=lambda x: x[1])]
    pn_hits = [u for u in ranked if pn_norm and pn_norm in normalize_pn(u)]
    images = pn_hits[:12] if pn_hits else [u for u in ranked if "partsimages" in u][:12]

    title = None
    make = None
    models: list[str] = []
    matched_card = None

    # DOM path: result cards expose `.compatible-models` with `<li>` model names.
    # Scope to the first card whose number matches our PN (avoid substitution rows).
    for car in soup.select("a.compatibility-car[data-number]"):
        data_number = normalize_pn(car.get("data-number") or "")
        if pn_norm and data_number != pn_norm:
            continue
        make = (car.get("data-make") or "").strip() or make
        matched_card = car.find_parent(class_=re.compile(r"product-v2-card|product-col|caption"))
        block = car.find_parent(class_=re.compile(r"compatible-models"))
        if block:
            for li in block.find_all("li"):
                _add_models(models, li.get_text(" ", strip=True))
        if models or matched_card:
            break

    # Title from the matching product card heading.
    title_block = matched_card
    if title_block is None:
        for h2 in soup.select("h2.part-col-list-h5"):
            if pn_upper and pn_upper in h2.get_text(" ", strip=True).upper():
                title_block = h2.find_parent(class_=re.compile(r"caption|product-v2"))
                break
    if title_block is not None:
        h1 = title_block.select_one("h1.part-col-list-h4") or title_block.find("h1")
        if h1:
            cand = h1.get_text(" ", strip=True)
            if cand and cand.lower() not in ("chat", "search result") and "search result" not in cand.lower():
                title = cand
        make_el = title_block.select_one(".make-brand a[data-title], a[data-title]")
        if make_el and not make:
            make = (make_el.get("data-title") or make_el.get_text(" ", strip=True) or "").strip() or make

    if not title:
        for img in soup.find_all("img"):
            alt = (img.get("alt") or img.get("title") or "").strip()
            if not alt or pn_upper not in alt.upper():
                continue
            # alt like "Mitsubishi 1230A153 FILTER ASSY,OIL"
            rest = re.sub(re.escape(pn_upper), "", alt, flags=re.I).strip(" -|,")
            # Drop leading brand token if present
            parts = [p for p in re.split(r"\s+", rest) if p]
            if parts and brand and parts[0].upper() == brand.upper():
                parts = parts[1:]
            cand = " ".join(parts).strip()
            if cand and cand.lower() not in ("chat",):
                title = cand
                break

    if not models:
        # Fallback: text lines. PartSouq renders "Make:" / "Compatibility:" as labels
        # with values on the following lines (not "Make: Mitsubishi" inline).
        lines = [ln.strip() for ln in soup.get_text("\n", strip=True).splitlines() if ln.strip()]
        pn_idxs = [
            i
            for i, ln in enumerate(lines)
            if pn_upper and pn_upper in ln.upper() and "part number" in ln.lower()
        ]
        if not pn_idxs:
            pn_idxs = [i for i, ln in enumerate(lines) if pn_upper and pn_upper in ln.upper()]
        start = pn_idxs[0] if pn_idxs else 0
        window = lines[start : start + 120]
        for i, line in enumerate(window):
            low = line.lower()
            if low == "make:" and i + 1 < len(window):
                make = window[i + 1].strip() or make
            elif low.startswith("make:") and ":" in line:
                make = line.split(":", 1)[1].strip() or make
            if low == "compatibility:" or low.startswith("compatible with"):
                for nxt in window[i + 1 :]:
                    nlow = nxt.lower()
                    if nlow in ("make:", "compatibility:", "compatible with:"):
                        break
                    if nlow.startswith(
                        ("part number", "availability", "make:", "processing", "substitutions", "compatible")
                    ):
                        break
                    if nlow in ("add", "not available", "table view") or nxt in ("$", "×", "..."):
                        break
                    if nxt.startswith("#") or re.fullmatch(r"\d+(\.\d+)?", nxt):
                        break
                    if len(nxt) > 100:
                        break
                    _add_models(models, nxt)
                break

    if brand and not make:
        make = brand

    return {
        "pn": pn,
        "brand": brand,
        "title": title,
        "make": make,
        "imageUrls": images[:12],
        "models": models[:40],
        "sourceUrl": f"{BASE}/en/search/all?q={pn}",
        "source": "partsouq.com",
    }


def fetch_one(scraper, pn: str, brand: str | None = None, retries: int = 3) -> dict[str, Any]:
    url = f"{BASE}/en/search/all?q={pn}"
    last_err = None
    for attempt in range(retries):
        try:
            res = scraper.get(url, timeout=60, headers={"User-Agent": USER_AGENT})
            if res.status_code == 403:
                last_err = f"HTTP 403 (attempt {attempt + 1})"
                time.sleep(2 + attempt * 2)
                # Recreate scraper after CF challenge failure.
                scraper = create_scraper()
                continue
            if res.status_code >= 400:
                return {
                    "pn": pn,
                    "brand": brand,
                    "ok": False,
                    "error": f"HTTP {res.status_code}",
                    "imageUrls": [],
                    "models": [],
                }
            parsed = parse_search_html(res.text, pn, brand)
            parsed["ok"] = bool(parsed["imageUrls"] or parsed["models"] or parsed.get("title"))
            if not parsed["ok"]:
                parsed["error"] = "empty_parse"
            return parsed
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            time.sleep(1 + attempt)
    return {
        "pn": pn,
        "brand": brand,
        "ok": False,
        "error": last_err or "fetch_failed",
        "imageUrls": [],
        "models": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pn")
    parser.add_argument("--brand")
    parser.add_argument("--batch-jsonl", action="store_true")
    parser.add_argument("--delay-ms", type=int, default=700)
    args = parser.parse_args()

    scraper = create_scraper()

    if args.batch_jsonl:
        for raw in sys.stdin:
            raw = raw.strip()
            if not raw:
                continue
            item = json.loads(raw)
            result = fetch_one(scraper, str(item["pn"]), item.get("brand"))
            print(json.dumps(result, ensure_ascii=False), flush=True)
            time.sleep(max(0, args.delay_ms) / 1000.0)
        return 0

    if not args.pn:
        parser.error("--pn or --batch-jsonl is required")
    print(json.dumps(fetch_one(scraper, args.pn, args.brand), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
