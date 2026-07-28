#!/bin/bash
set -eu

echo "==== Homepage 'Recently listed' (newest first) seller breakdown ===="
docker exec partsbazar360-api-1 sh -lc 'wget -qO- "http://127.0.0.1:3001/search/parts?sort=newest&limit=8"' | python3 -c '
import sys,json
d=json.load(sys.stdin)
for it in d.get("items",[]):
    off=it.get("offers",[]) or []
    s=off[0].get("sellerName") if off else None
    print(it.get("brand"), "|", s, "|", it.get("createdAt"), "|", it.get("title","")[:50])
print("total", d.get("total"))
'

echo
echo "==== FEBEST brand browse seller breakdown ===="
docker exec partsbazar360-api-1 sh -lc 'wget -qO- "http://127.0.0.1:3001/search/parts?brand=FEBEST&limit=24"' | python3 -c '
import sys,json,collections
d=json.load(sys.stdin)
c=collections.Counter()
for it in d.get("items",[]):
    for o in it.get("offers",[]) or []:
        c[o.get("sellerName")]+=1
print("page sellers:", dict(c), "total", d.get("total"))
for it in d.get("items",[])[:5]:
    off=it.get("offers",[]) or []
    print(it.get("brand"),"|",off[0].get("sellerName") if off else None,"|",it.get("createdAt"),"|",it.get("title","")[:50])
'

echo
echo "==== createdAt distribution by seller (DB) ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name, MIN(p.\"createdAt\") AS oldest, MAX(p.\"createdAt\") AS newest, COUNT(*) AS parts
FROM \"CanonicalPart\" p
JOIN \"SellerOffer\" o ON o.\"canonicalPartId\"=p.id
JOIN \"Seller\" s ON s.id=o.\"sellerId\"
WHERE p.brand ILIKE '%FEBEST%' AND o.status='ACTIVE' AND s.\"onboardingStatus\"='ACTIVE'
GROUP BY 1 ORDER BY 3 DESC;
"

echo
echo "==== OpenSearch createdAt sample for Superior FEBEST ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":3,\"query\":{\"bool\":{\"must\":[{\"term\":{\"brand.keyword\":\"FEBEST\"}},{\"term\":{\"offers.sellerName.keyword\":\"Superior Auto Parts\"}}]}},\"_source\":[\"id\",\"title\",\"createdAt\",\"offers\"],\"sort\":[{\"createdAt\":\"desc\"}]}"'

echo
echo "==== OpenSearch createdAt sample for Salvage FEBEST ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":3,\"query\":{\"bool\":{\"must\":[{\"term\":{\"brand.keyword\":\"FEBEST\"}},{\"term\":{\"offers.sellerName.keyword\":\"Salvage Auto Parts\"}}]}},\"_source\":[\"id\",\"title\",\"createdAt\",\"offers\"],\"sort\":[{\"createdAt\":\"desc\"}]}"'
