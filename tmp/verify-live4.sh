#!/bin/bash
echo "=== Salvage PDP (Jaguar F-Pace, first browse result) ==="
PID=$(curl -s "https://partsbazar360.realtrackapp.com/api/search/parts?sort=newest&limit=1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["items"][0]["id"])')
echo "part_id=$PID"
curl -s "https://partsbazar360.realtrackapp.com/api/search/parts/$PID" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("title:",d.get("title")); print("brand:",d.get("brand")); print("num_images:",len(d.get("imageUrls") or [])); print("images:",(d.get("imageUrls") or [])[:3]); ct=d.get("compatibilityTable") or []; print("compat_rows:",len(ct),"mvl_verified:",sum(1 for r in ct if r.get("mvlVerified")),"/",len(ct)); print("sample_rows:",ct[:3]); print("seller:",[o.get("seller",{}).get("name") for o in d.get("offers",[])])'

echo
echo "=== sitemap: count part URLs + check stale id absent ==="
curl -s "https://partsbazar360.realtrackapp.com/sitemap.xml" | python3 -c 'import sys,re; x=sys.stdin.read(); urls=re.findall(r"<loc>([^<]+)</loc>",x); part=[u for u in urls if "/part/" in u]; print("total_urls:",len(urls),"part_urls:",len(part)); print("stale_present:", "6f3f8d2a-5bf1-49e0-aede-7668a17bc826" in x); [print(" ",u) for u in part[:5]]'
