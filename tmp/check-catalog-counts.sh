#!/bin/bash
set -e
echo "=== OpenSearch ==="
sudo docker exec partsbazar360-opensearch-1 curl -s "http://localhost:9200/canonical_parts/_count"
echo
echo "=== Postgres ==="
sudo docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT
  (SELECT count(*) FROM \"SellerOffer\" WHERE status = 'ACTIVE') AS active_offers,
  (SELECT count(DISTINCT \"canonicalPartId\") FROM \"SellerOffer\" WHERE status = 'ACTIVE') AS parts_with_active,
  (SELECT count(*) FROM \"CanonicalPart\") AS canonical_parts,
  (SELECT count(*) FROM \"SellerOffer\") AS all_offers;
"
echo "=== Offers by status ==="
sudo docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT status, count(*) FROM \"SellerOffer\" GROUP BY status ORDER BY count(*) DESC;
"
echo "=== Sellers with ACTIVE offers ==="
sudo docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.\"displayName\", s.\"onboardingStatus\", count(o.id) AS offers
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id = o.\"sellerId\"
WHERE o.status = 'ACTIVE'
GROUP BY s.\"displayName\", s.\"onboardingStatus\"
ORDER BY offers DESC
LIMIT 20;
"
