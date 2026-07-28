#!/bin/bash
set -eu

echo "==== Docs still under FEBEST Inventory Supplier ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":20,\"query\":{\"term\":{\"offers.sellerName.keyword\":\"FEBEST Inventory Supplier\"}},\"_source\":[\"id\",\"title\",\"brand\",\"manufacturerPartNumber\",\"offers\"]}"'

echo
echo "==== DB offers for those seller ids ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name, o.status, COUNT(*)
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id=o.\"sellerId\"
WHERE s.id IN ('seed-febest-inventory-supplier','seller-superior-auto-parts','seller-salvage-auto-parts')
GROUP BY 1,2 ORDER BY 1,2;
"

echo
echo "==== Inventory schema peek ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "\d \"Inventory\"" | head -40

echo
echo "==== API health / search ===="
docker exec partsbazar360-api-1 sh -lc 'wget -qO- http://127.0.0.1:3001/api/search/parts?limit=1 2>/dev/null | head -c 800 || wget -qO- http://127.0.0.1:3000/api/search/parts?limit=1 2>/dev/null | head -c 800 || curl -s http://127.0.0.1:3000/search/parts?limit=1 | head -c 800 || netstat -tlnp 2>/dev/null | head -20 || ss -tlnp | head -20'
