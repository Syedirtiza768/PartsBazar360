#!/bin/bash
set -eu

echo "==== BEFORE: OpenSearch docs + DB ACTIVE parts ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s http://opensearch:9200/canonical_parts/_count || true'
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT COUNT(DISTINCT o.\"canonicalPartId\") AS active_parts_in_db
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id = o.\"sellerId\"
WHERE o.status = 'ACTIVE' AND s.\"onboardingStatus\" = 'ACTIVE';
"

echo "==== Copy + run reindex (wipe + rebuild ACTIVE only) ===="
docker cp /tmp/reindex-active-from-db.mjs partsbazar360-api-1:/tmp/reindex-active-from-db.mjs
docker exec partsbazar360-api-1 sh -lc 'node /tmp/reindex-active-from-db.mjs' 2>&1 | tee /tmp/reindex-active.log

echo "==== AFTER: OpenSearch docs ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s http://opensearch:9200/canonical_parts/_count || true'
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search?size=0" -H "content-type: application/json" -d "{\"aggs\":{\"by_seller\":{\"nested\":{\"path\":\"offers\"},\"aggs\":{\"sellers\":{\"terms\":{\"field\":\"offers.sellerName.keyword\",\"size\":10}}}}}}" || true'
tail -n 30 /tmp/reindex-active.log
