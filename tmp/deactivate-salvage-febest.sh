#!/bin/bash
set -eu

echo "==== Before: Salvage FEBEST active offers ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name, p.brand, o.status, COUNT(*) AS offers
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id=o.\"sellerId\"
JOIN \"CanonicalPart\" p ON p.id=o.\"canonicalPartId\"
WHERE s.name='Salvage Auto Parts' AND p.brand ILIKE '%FEBEST%'
GROUP BY 1,2,3 ORDER BY 1,2,3;
"

echo "==== Deactivate Salvage FEBEST offers (FEBEST is sold under Superior) ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
UPDATE \"SellerOffer\" o
SET status = 'INACTIVE', \"updatedAt\" = NOW()
FROM \"Seller\" s, \"CanonicalPart\" p
WHERE o.\"sellerId\" = s.id
  AND o.\"canonicalPartId\" = p.id
  AND s.name = 'Salvage Auto Parts'
  AND p.brand ILIKE '%FEBEST%'
  AND o.status = 'ACTIVE';
"

echo "==== After: Salvage FEBEST offer statuses ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name, p.brand, o.status, COUNT(*) AS offers
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id=o.\"sellerId\"
JOIN \"CanonicalPart\" p ON p.id=o.\"canonicalPartId\"
WHERE s.name='Salvage Auto Parts' AND p.brand ILIKE '%FEBEST%'
GROUP BY 1,2,3 ORDER BY 1,2,3;
"

echo "==== Check seed-salvagea job still running? ===="
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep -E "seed-salvagea|seed:salvagea" | grep -v grep || echo NOT_RUNNING'
ls -la /tmp/seed-salvagea.log 2>/dev/null && tail -n 5 /tmp/seed-salvagea.log 2>/dev/null || true

echo "==== Wipe + reindex ACTIVE offers only ===="
docker exec partsbazar360-api-1 sh -lc 'cd /app && node scripts/reindex-active-from-db.mjs' 2>&1 | tail -n 8

echo "==== Seller buckets after reindex ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":0,\"aggs\":{\"sellers\":{\"terms\":{\"field\":\"offers.sellerName.keyword\",\"size\":10}}}}"'
echo

echo "==== FEBEST brand browse seller breakdown ===="
docker exec partsbazar360-api-1 sh -lc 'wget -qO- "http://127.0.0.1:3001/search/parts?brand=FEBEST&limit=8"' | python3 -c '
import sys,json,collections
d=json.load(sys.stdin)
c=collections.Counter()
for it in d.get("items",[]):
    for o in it.get("offers",[]) or []:
        c[o.get("sellerName")]+=1
print("page sellers:", dict(c), "total", d.get("total"))
for it in d.get("items",[])[:5]:
    off=it.get("offers",[]) or []
    print(it.get("brand"),"|",off[0].get("sellerName") if off else None,"|",it.get("title","")[:50])
'

echo
echo "==== Homepage Recently listed ===="
docker exec partsbazar360-api-1 sh -lc 'wget -qO- "http://127.0.0.1:3001/search/parts?sort=newest&limit=8"' | python3 -c '
import sys,json,collections
d=json.load(sys.stdin)
c=collections.Counter()
for it in d.get("items",[]):
    off=it.get("offers",[]) or []
    c[off[0].get("sellerName") if off else None]+=1
print("homepage sellers:", dict(c))
'
