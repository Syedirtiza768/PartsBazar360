#!/bin/bash
set -euo pipefail

echo "=== Sellers with ACTIVE offers ==="
sudo docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name, s.\"onboardingStatus\", count(o.id) AS offers
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id = o.\"sellerId\"
WHERE o.status = 'ACTIVE'
GROUP BY s.name, s.\"onboardingStatus\"
ORDER BY offers DESC;
"

echo "=== Parts eligible for search (ACTIVE offer + ACTIVE seller) ==="
sudo docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -tAc "
SELECT count(DISTINCT o.\"canonicalPartId\")
FROM \"SellerOffer\" o
JOIN \"Seller\" s ON s.id = o.\"sellerId\"
WHERE o.status = 'ACTIVE' AND s.\"onboardingStatus\" = 'ACTIVE';
"
