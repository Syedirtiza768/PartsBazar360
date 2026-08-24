#!/usr/bin/env python3
"""Cache verified LEMFORDER/FEBI source images into a production staging dir.

The script deliberately keeps the supplier URL as provenance and only records
an image as cached after receiving an actual JPEG, PNG, or WebP response.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookiejar import CookieJar
from pathlib import Path
from threading import local, Lock
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, build_opener, HTTPBasicAuthHandler, HTTPPasswordMgrWithDefaultRealm
import json
import os
import subprocess
import time


DB_CONTAINER = os.environ.get("DB_CONTAINER", "partsbazar360-postgres-1")
CACHE_DIR = Path(os.environ.get("CACHE_DIR", "/tmp/catalog-image-cache"))
WORKERS = max(1, min(12, int(os.environ.get("WORKERS", "8"))))
MAX_BYTES = 15 * 1024 * 1024
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
THREAD = local()
PRINT_LOCK = Lock()

SQL = r"""
SELECT cp.id,
       upper(trim(cp.brand)),
       COALESCE(cp."manufacturerPartNumber", ''),
       COALESCE(cp."listingUrl", ''),
       u.ord - 1,
       u.url
FROM "CanonicalPart" cp
JOIN "SellerOffer" so
  ON so."canonicalPartId" = cp.id
 AND so.status = 'ACTIVE'
CROSS JOIN LATERAL unnest(COALESCE(cp."imageUrls", ARRAY[]::text[])) WITH ORDINALITY AS u(url, ord)
WHERE upper(trim(cp.brand)) IN ('LEMFORDER', 'FEBI')
GROUP BY cp.id, cp.brand, cp."manufacturerPartNumber", cp."listingUrl", u.ord, u.url
ORDER BY cp.id, u.ord;
"""


def db_rows():
    output = subprocess.check_output(
        [
            "docker", "exec", "-i", DB_CONTAINER,
            "psql", "-U", "partsbazar_user", "-d", "partsbazar_db",
            "-At", "-F", "\t", "-c", SQL,
        ],
        text=True,
    )
    rows = []
    for line in output.splitlines():
        fields = line.split("\t", 5)
        if len(fields) != 6:
            continue
        part_id, brand, mpn, listing_url, slot, source_url = fields
        rows.append({
            "id": part_id,
            "brand": brand,
            "mpn": mpn,
            "listingUrl": listing_url,
            "slot": int(slot),
            "sourceUrl": source_url,
        })
    return rows


def opener_for_thread():
    if not hasattr(THREAD, "opener"):
        THREAD.opener = build_opener(__import__("urllib.request").request.HTTPCookieProcessor(CookieJar()))
    return THREAD.opener


def source_page(row):
    parsed = urlparse(row["sourceUrl"])
    if parsed.hostname != "www.fcpeuro.com":
        return None
    return "https://www.fcpeuro.com/Parts?keywords=LEM-" + quote(row["mpn"], safe="")


def content_extension(content_type, data):
    kind = (content_type or "").split(";", 1)[0].lower()
    if kind in ("image/jpeg", "image/jpg") or data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if kind == "image/png" or data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if kind == "image/webp" or (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        return "webp"
    return None


def fetch(row):
    opener = opener_for_thread()
    page = source_page(row)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }
    if page:
        headers.update({
            "Referer": page,
            "Sec-Fetch-Dest": "image",
            "Sec-Fetch-Mode": "no-cors",
            "Sec-Fetch-Site": "same-origin",
        })

    last_error = ""
    for attempt in range(1, 4):
        try:
            if page:
                opener.open(Request(page, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}), timeout=30).read(1024)
                time.sleep(0.15)
            response = opener.open(Request(row["sourceUrl"], headers=headers), timeout=30)
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                return {**row, "status": "too_large", "error": f">{MAX_BYTES} bytes"}
            extension = content_extension(response.headers.get("Content-Type"), data)
            if not extension:
                return {**row, "status": "not_image", "error": response.headers.get("Content-Type", "")}
            filename = f'{row["id"]}-{row["slot"]}.{extension}'
            path = CACHE_DIR / filename
            path.write_bytes(data)
            return {
                **row,
                "status": "cached",
                "extension": extension,
                "path": str(path),
                "localUrl": f'/api/search/parts/{row["id"]}/catalog-image/{row["slot"]}.{extension}',
                "bytes": len(data),
            }
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last_error = str(exc)
            time.sleep(min(5, attempt * 1.5))
    return {**row, "status": "failed", "error": last_error}


def main():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    rows = db_rows()
    results = []
    completed = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(fetch, row) for row in rows]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            completed += 1
            if completed % 100 == 0:
                with PRINT_LOCK:
                    print(json.dumps({"event": "progress", "completed": completed, "total": len(rows)}), flush=True)

    results.sort(key=lambda item: (item["id"], item["slot"]))
    parts = {}
    for row in rows:
        part = parts.setdefault(row["id"], {
            "id": row["id"],
            "brand": row["brand"],
            "mpn": row["mpn"],
            "imageUrls": [],
            "cached": [],
        })
        while len(part["imageUrls"]) <= row["slot"]:
            part["imageUrls"].append(None)
        part["imageUrls"][row["slot"]] = row["sourceUrl"]
    for result in results:
        part = parts[result["id"]]
        if result["status"] == "cached":
            part["imageUrls"][result["slot"]] = result["localUrl"]
            part["cached"].append({
                "slot": result["slot"],
                "sourceUrl": result["sourceUrl"],
                "localUrl": result["localUrl"],
                "extension": result["extension"],
                "bytes": result["bytes"],
            })
    for part in parts.values():
        part["imageUrls"] = [url for url in part["imageUrls"] if url]

    (CACHE_DIR / "results.json").write_text(json.dumps(results), encoding="utf-8")
    (CACHE_DIR / "parts.json").write_text(json.dumps(list(parts.values())), encoding="utf-8")
    summary = {
        "sourceRows": len(rows),
        "parts": len(parts),
        "cached": sum(result["status"] == "cached" for result in results),
        "failed": sum(result["status"] == "failed" for result in results),
        "notImage": sum(result["status"] == "not_image" for result in results),
        "tooLarge": sum(result["status"] == "too_large" for result in results),
        "workers": WORKERS,
        "cacheDir": str(CACHE_DIR),
    }
    (CACHE_DIR / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"event": "complete", **summary}), flush=True)


if __name__ == "__main__":
    main()
