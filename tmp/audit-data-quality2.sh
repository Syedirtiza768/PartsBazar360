#!/bin/bash
set -eu

echo "==== Salvage active sample (newest 12) with storeId from RawStagingListing ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT p.title, p.brand, p.\"ebayItemId\", r.\"storeId\", r.title AS raw_title, r.status, r.\"lastSyncedAt\"
FROM \"CanonicalPart\" p
JOIN \"SellerOffer\" o ON o.\"canonicalPartId\"=p.id JOIN \"Seller\" s ON s.id=o.\"sellerId\"
LEFT JOIN \"RawStagingListing\" r ON r.\"ebayItemId\"=p.\"ebayItemId\"
WHERE s.name='Salvage Auto Parts' AND o.status='ACTIVE'
ORDER BY p.\"createdAt\" DESC LIMIT 12;
"

echo
echo "==== StoreId distribution for Salvage active parts ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT r.\"storeId\", COUNT(DISTINCT p.id) AS parts
FROM \"CanonicalPart\" p
JOIN \"SellerOffer\" o ON o.\"canonicalPartId\"=p.id JOIN \"Seller\" s ON s.id=o.\"sellerId\"
LEFT JOIN \"RawStagingListing\" r ON r.\"ebayItemId\"=p.\"ebayItemId\"
WHERE s.name='Salvage Auto Parts' AND o.status='ACTIVE'
GROUP BY 1 ORDER BY 2 DESC;
"

echo
echo "==== Offers missing price/currency/condition ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT s.name,
  COUNT(*) FILTER (WHERE o.price IS NULL) AS no_price,
  COUNT(*) FILTER (WHERE o.currency IS NULL OR o.currency='') AS no_currency,
  COUNT(*) FILTER (WHERE o.condition IS NULL OR o.condition='') AS no_condition
FROM \"SellerOffer\" o JOIN \"Seller\" s ON s.id=o.\"sellerId\"
WHERE o.status='ACTIVE' AND s.\"onboardingStatus\"='ACTIVE'
GROUP BY 1;
"

echo
echo "==== Stale parts (zero offers) ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT COUNT(*) AS parts_with_zero_offers,
       COUNT(*) FILTER (WHERE p.\"ebayItemId\" IS NOT NULL) AS with_ebay,
       COUNT(*) FILTER (WHERE p.brand ILIKE '%febest%') AS febest_branded
FROM \"CanonicalPart\" p
WHERE NOT EXISTS (SELECT 1 FROM \"SellerOffer\" o WHERE o.\"canonicalPartId\"=p.id);
"

echo
echo "==== OS count vs DB active ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s http://opensearch:9200/canonical_parts/_count'
echo
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -t -c "SELECT COUNT(DISTINCT o.\"canonicalPartId\") FROM \"SellerOffer\" o JOIN \"Seller\" s ON s.id=o.\"sellerId\" WHERE o.status='ACTIVE' AND s.\"onboardingStatus\"='ACTIVE';"

echo
echo "==== RawStagingListing columns ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "\d \"RawStagingListing\"" | head -30
