#!/usr/bin/env python3
"""
Enrich Superior Auto Parts (non-FEBEST) with images from PartSouq via FlareSolverr.

Uses FlareSolverr to bypass Cloudflare, then parses PartSouq HTML for product images.
Stores image URLs in CanonicalPart.imageUrls and ProductMedia table.

Usage:
  python3 enrich_partsouq_flaresolverr.py [--limit N] [--force] [--delay-ms N] [--brand BRAND]
"""
import argparse, json, os, re, sys, time, urllib.request
from urllib.parse import urljoin

FLARESOLVERR_URL = os.environ.get("FLARESOLVERR_URL", "http://flaresolverr:8191/v1")
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Brand → PartSouq image path mapping (observed from testing)
# PartSouq stores images at: partsouq.com/assets/tesseract/assets/partsimages/{Brand}/{PN}.jpg
# But we also need to parse from search result HTML

def normalize_pn(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())

def flaresolverr_get(url, timeout=30000):
    """Fetch a URL via FlareSolverr, return HTML."""
    payload = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": timeout}).encode()
    req = urllib.request.Request(FLARESOLVERR_URL, data=payload, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout // 1000 + 15)
        data = json.loads(resp.read())
        sol = data.get("solution", {})
        return {"ok": True, "status": sol.get("status", 0), "html": sol.get("response", "")}
    except Exception as e:
        return {"ok": False, "status": 0, "html": "", "error": str(e)[:100]}

def parse_partsouq_images(html, pn):
    """Extract product image URLs from PartSouq search HTML."""
    pn_norm = normalize_pn(pn)
    images = []
    
    # Pattern 1: partsimages CDN
    for m in re.finditer(r'(https?://[^\s"\']*partsimages[^\s"\']*)', html):
        url = m.group(1).replace("&amp;", "&")
        if url not in images:
            images.append(url)
    
    # Pattern 2: tesseract paths
    for m in re.finditer(r'(https?://[^\s"\']*tesseract[^\s"\']*)', html):
        url = m.group(1).replace("&amp;", "&")
        if url not in images:
            images.append(url)
    
    # Pattern 3: PartThumbnail / PartCoverThumbnail
    for m in re.finditer(r'(https?://[^\s"\']*(?:PartThumbnail|PartCoverThumbnail)[^\s"\']*)', html):
        url = m.group(1).replace("&amp;", "&")
        if url not in images:
            images.append(url)
    
    # Rank: prefer images containing the PN
    def rank(url):
        u = normalize_pn(url)
        if pn_norm and pn_norm in u:
            return 0
        return 1
    
    images.sort(key=rank)
    return images[:12]

def fetch_partsouq_image(pn, brand=None):
    """Search PartSouq for a part number and extract image URLs."""
    url = f"https://partsouq.com/en/search/all?q={pn}"
    result = flaresolverr_get(url)
    
    if not result["ok"]:
        return {"ok": False, "error": result.get("error", "fetch_failed"), "images": []}
    
    html = result["html"]
    if "Just a moment" in html or "cf-chl" in html:
        return {"ok": False, "error": "cloudflare_blocked", "images": []}
    
    images = parse_partsouq_images(html, pn)
    has_results = "product-v2-card" in html or "part-col-list" in html
    
    return {
        "ok": bool(images),
        "images": images,
        "has_results": has_results,
        "source_url": url,
    }

def get_db_connection():
    """Get PostgreSQL connection from DATABASE_URL."""
    import re as re_mod
    m = re_mod.match(r"postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)", DATABASE_URL)
    if not m:
        raise ValueError(f"Cannot parse DATABASE_URL: {DATABASE_URL[:30]}...")
    user, password, host, port, dbname = m.groups()
    
    import subprocess
    # We'll use docker exec to run psql instead of direct connection
    return {"host": host, "port": port, "user": user, "password": password, "dbname": dbname}

def run_sql(sql, fetch=True):
    """Execute SQL via docker exec psql."""
    import subprocess
    cmd = [
        "docker", "exec", "partsbazar360-postgres-1",
        "psql", "-U", "partsbazar_user", "-d", "partsbazar_db",
        "-t", "-A", "-c", sql
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return result.stdout.strip()
    except Exception as e:
        return f"ERROR: {e}"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--delay-ms", type=int, default=1500)
    parser.add_argument("--brand", type=str, default=None, help="Filter to specific brand")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    
    # Get parts without images (excluding FEBEST which has its own enrichment)
    brand_filter = ""
    if args.brand:
        brand_filter = f"AND cp.brand = '{args.brand}'"
    else:
        brand_filter = "AND cp.brand != 'FEBEST'"
    
    sql = f"""
    SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber" as mpn, 
           cp."oeNumbers"[1] as oe1,
           array_length(cp."imageUrls", 1) as img_count
    FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
    JOIN "Seller" s ON so."sellerId" = s.id
    WHERE s.name = 'Superior Auto Parts'
    AND (cp."imageUrls" IS NULL OR cp."imageUrls" = '{{}}' OR array_length(cp."imageUrls", 1) = 0)
    {brand_filter}
    AND cp."manufacturerPartNumber" IS NOT NULL
    ORDER BY cp.brand, cp."manufacturerPartNumber"
    """
    
    if args.limit:
        sql += f" LIMIT {args.limit}"
    
    print(f"Querying parts without images...", file=sys.stderr)
    
    import subprocess
    cmd = [
        "docker", "exec", "partsbazar360-postgres-1",
        "psql", "-U", "partsbazar_user", "-d", "partsbazar_db",
        "-t", "-A", "-F", "|", "-c", sql
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    
    parts = []
    for line in result.stdout.strip().split("\n"):
        if not line.strip():
            continue
        fields = line.split("|")
        if len(fields) >= 4:
            parts.append({
                "id": fields[0].strip(),
                "title": (fields[1].strip() or "")[:80],
                "brand": fields[2].strip(),
                "mpn": fields[3].strip(),
                "oe1": fields[4].strip() if len(fields) > 4 else "",
                "img_count": fields[5].strip() if len(fields) > 5 else "0",
            })
    
    print(f"Found {len(parts)} parts without images", file=sys.stderr)
    
    if args.dry_run:
        brands = {}
        for p in parts:
            brands[p["brand"]] = brands.get(p["brand"], 0) + 1
        print(f"\nBrand breakdown:")
        for brand, count in sorted(brands.items(), key=lambda x: -x[1]):
            print(f"  {brand}: {count}")
        return
    
    # Process parts
    ok = 0
    fail = 0
    not_found = 0
    start = time.time()
    
    for i, part in enumerate(parts):
        mpn = part["mpn"]
        brand = part["brand"]
        
        if not mpn:
            continue
        
        result = fetch_partsouq_image(mpn, brand)
        
        if result["ok"] and result["images"]:
            # Store images
            images = result["images"]
            image_array = "{" + ",".join(f'"{img}"' for img in images[:5]) + "}"
            
            update_sql = f"""
            UPDATE "CanonicalPart" 
            SET "imageUrls" = '{image_array}'::text[],
                "updatedAt" = NOW()
            WHERE id = '{part["id"]}'
            """
            
            if not args.dry_run:
                run_sql(update_sql)
            
            ok += 1
            print(json.dumps({
                "event": "progress",
                "idx": i + 1,
                "total": len(parts),
                "status": "ok",
                "brand": brand,
                "pn": mpn,
                "images": len(images),
                "first_img": images[0][:100] if images else None,
                "ok": ok,
                "fail": fail,
                "not_found": not_found,
            }), flush=True)
        elif result.get("error") == "cloudflare_blocked":
            fail += 1
            print(json.dumps({
                "event": "error",
                "idx": i + 1,
                "brand": brand,
                "pn": mpn,
                "error": "cloudflare_blocked",
            }), flush=True)
            time.sleep(5)  # Extra delay on CF block
        else:
            not_found += 1
            if (i + 1) % 50 == 0:
                print(json.dumps({
                    "event": "progress",
                    "idx": i + 1,
                    "total": len(parts),
                    "status": "not_found",
                    "brand": brand,
                    "pn": mpn,
                    "ok": ok,
                    "fail": fail,
                    "not_found": not_found,
                }), flush=True)
        
        time.sleep(args.delay_ms / 1000.0)
    
    elapsed = time.time() - start
    print(json.dumps({
        "event": "done",
        "ok": ok,
        "fail": fail,
        "not_found": not_found,
        "total": len(parts),
        "elapsed_seconds": int(elapsed),
    }))

if __name__ == "__main__":
    main()
