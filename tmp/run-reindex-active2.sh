#!/bin/bash
set -eu

echo "==== BEFORE ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s http://opensearch:9200/canonical_parts/_count'
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -t -c "
SELECT COUNT(DISTINCT o.\"canonicalPartId\")
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id = o.\"sellerId\"
WHERE o.status = 'ACTIVE' AND s.\"onboardingStatus\" = 'ACTIVE';
"

echo "==== Reindex from /app (Prisma available) ===="
docker cp /tmp/reindex-active-from-db.mjs partsbazar360-api-1:/app/scripts/reindex-active-from-db.mjs
docker exec partsbazar360-api-1 sh -lc 'cd /app && node scripts/reindex-active-from-db.mjs' 2>&1 | tee /tmp/reindex-active.log

echo "==== AFTER ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s http://opensearch:9200/canonical_parts/_count'
echo
tail -n 20 /tmp/reindex-active.log

echo "==== Seller breakdown (DB ACTIVE) ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name, COUNT(DISTINCT o.\"canonicalPartId\") AS parts, COUNT(*) AS offers
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id = o.\"sellerId\"
WHERE o.status = 'ACTIVE' AND s.\"onboardingStatus\" = 'ACTIVE'
GROUP BY 1 ORDER BY 2 DESC;
"
