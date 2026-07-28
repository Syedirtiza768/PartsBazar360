#!/bin/bash
echo "=== stale PDP (expect 404) ==="
curl -s -o /dev/null -w "%{http_code}\n" https://partsbazar360.realtrackapp.com/api/search/parts/6f3f8d2a-5bf1-49e0-aede-7668a17bc826

echo "=== search?q=FEBEST top 5 ==="
curl -s "https://partsbazar360.realtrackapp.com/api/search/parts?q=FEBEST&limit=5" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("total",d.get("total")); [print(i.get("title"),"| sellers:",[o.get("sellerName") for o in i.get("offers",[])]) for i in d.get("items",[])[:5]]'

echo "=== browse newest top 8 (titles + sellers + minPrice) ==="
curl -s "https://partsbazar360.realtrackapp.com/api/search/parts?sort=newest&limit=8" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("total",d.get("total")); [print(i.get("title"),"|",i.get("minPrice"),"|",[o.get("sellerName") for o in i.get("offers",[])]) for i in d.get("items",[])[:8]]'

echo "=== OS doc count ==="
sudo docker compose exec -T opensearch curl -s http://localhost:9200/canonical_parts/_count
echo
