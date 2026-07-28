#!/bin/bash
set -eu

echo "==== Sample Superior FEBEST from OpenSearch ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":3,\"query\":{\"bool\":{\"must\":[{\"term\":{\"brand.keyword\":\"FEBEST\"}}]}},\"_source\":[\"id\",\"title\",\"brand\",\"manufacturerPartNumber\",\"offers\",\"minPrice\"]}"'

echo
echo "==== Sample Salvage from OpenSearch ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":2,\"query\":{\"term\":{\"offers.sellerName.keyword\":\"Salvage Auto Parts\"}},\"_source\":[\"id\",\"title\",\"brand\",\"offers\"]}"'

echo
echo "==== Docs with empty offers or bad seller ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":0,\"aggs\":{\"sellers\":{\"terms\":{\"field\":\"offers.sellerName.keyword\",\"size\":20}},\"no_offers\":{\"missing\":{\"field\":\"offers.sellerId.keyword\"}}}}"'

echo
echo "==== Live API browse sample ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://localhost:3000/api/search/parts?brand=FEBEST&limit=2" | head -c 2500'

echo
echo "==== Parts with ACTIVE offer but qty 0 ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name, COUNT(*) 
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id=o.\"sellerId\"
LEFT JOIN \"Inventory\" i ON i.\"sellerOfferId\"=o.id
WHERE o.status='ACTIVE' AND s.\"onboardingStatus\"='ACTIVE'
GROUP BY 1;
"

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name, COUNT(DISTINCT o.id) AS active_zero_stock
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id=o.\"sellerId\"
WHERE o.status='ACTIVE' AND s.\"onboardingStatus\"='ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM \"Inventory\" i WHERE i.\"sellerOfferId\"=o.id AND i.quantity > 0
  )
GROUP BY 1;
"
