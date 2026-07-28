#!/bin/bash
PID=$(curl -s "https://partsbazar360.realtrackapp.com/api/search/parts?sort=newest&limit=1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["items"][0]["id"])')
echo "=== Frontend PDP rendered HTML (MVL badge check) for $PID ==="
curl -s "https://partsbazar360.realtrackapp.com/buyer/part/$PID/" | python3 -c 'import sys; h=sys.stdin.read(); print("has_MVL_verified_badge:", "MVL verified" in h or "mvl" in h.lower()); print("has_Unverified_badge:", "Unverified" in h); print("has_image_gallery:", "img-proxy" in h or "i.ebayimg.com" in h or "static.febest.de" in h); print("has_Salvage_Auto_Parts:", "Salvage Auto Parts" in h); print("has_price:", "$" in h or "AED" in h or "USD" in h)'

echo
echo "=== Frontend homepage: count tiles + check each has seller+price ==="
curl -s "https://partsbazar360.realtrackapp.com/buyer/" | python3 -c 'import sys,re; h=sys.stdin.read(); cards=len(re.findall(r"product-card|ProductCard|data-part-id|/buyer/part/", h)); print("approx_part_links:", len(re.findall(r"/buyer/part/[A-Za-z0-9-]+", h))); print("has_Superior:", "Superior Auto Parts" in h); print("has_Salvage:", "Salvage Auto Parts" in h); print("has_FEBEST_Inventory_Supplier:", "FEBEST Inventory Supplier" in h)'

echo
echo "=== Stale PDP frontend (expect not-found/404) ==="
curl -s -o /dev/null -w "%{http_code}\n" "https://partsbazar360.realtrackapp.com/buyer/part/6f3f8d2a-5bf1-49e0-aede-7668a17bc826/"
