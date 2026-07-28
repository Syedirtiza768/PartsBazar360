#!/bin/bash
echo "=== browse newest top 12 ==="
curl -s "https://partsbazar360.realtrackapp.com/api/search/parts?sort=newest&limit=12" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); [print(i.get("title"),"|",i.get("minPrice"),"|",[o.get("sellerName") for o in i.get("offers",[])]) for i in d.get("items",[])[:12]]'

echo
echo "=== febest.de reachability from API container ==="
cd /home/ubuntu/PartsBazar360
sudo docker compose exec -T api sh -c 'wget -q -O- --timeout=8 "https://febest.de/en/catalog?code=MSS-C77FR" 2>&1 | head -c 200; echo; echo "EXIT=$?"' 2>&1 | head -5

echo
echo "=== FEBEST PDP images (MSS-C77FR) ==="
PID=$(curl -s "https://partsbazar360.realtrackapp.com/api/search/parts?q=MSS-C77FR&limit=1" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["items"][0]["id"] if d.get("items") else "")')
echo "part_id=$PID"
curl -s "https://partsbazar360.realtrackapp.com/api/search/parts/$PID" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("title:",d.get("title")); print("num_images:",len(d.get("imageUrls") or [])); print("images:",(d.get("imageUrls") or [])[:4]); ct=d.get("compatibilityTable") or []; print("compat_rows:",len(ct),"mvl_verified:",sum(1 for r in ct if r.get("mvlVerified")),"/",len(ct)); print("enrichmentSource:",d.get("enrichmentSource"),"enrichmentLive:",d.get("enrichmentLive"))'
