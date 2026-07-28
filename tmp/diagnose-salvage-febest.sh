#!/bin/bash
set -eu

echo "==== Salvage FEBEST sample (full) ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT p.title, p.brand, p.\"manufacturerPartNumber\", p.\"partSource\", p.\"qualityTier\",
       o.price, o.currency, o.condition, p.\"listingUrl\", p.\"ebayItemId\", p.\"createdAt\"
FROM \"CanonicalPart\" p
JOIN \"SellerOffer\" o ON o.\"canonicalPartId\"=p.id
JOIN \"Seller\" s ON s.id=o.\"sellerId\"
WHERE p.brand ILIKE '%FEBEST%' AND s.name='Salvage Auto Parts' AND o.status='ACTIVE'
ORDER BY p.\"createdAt\" DESC LIMIT 8;
"

echo
echo "==== MPN overlap Superior vs Salvage (FEBEST) ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
WITH sup AS (
  SELECT DISTINCT UPPER(p.\"manufacturerPartNumber\") AS mpn
  FROM \"CanonicalPart\" p JOIN \"SellerOffer\" o ON o.\"canonicalPartId\"=p.id JOIN \"Seller\" s ON s.id=o.\"sellerId\"
  WHERE p.brand ILIKE '%FEBEST%' AND s.name='Superior Auto Parts' AND o.status='ACTIVE' AND p.\"manufacturerPartNumber\" IS NOT NULL
),
sal AS (
  SELECT DISTINCT UPPER(p.\"manufacturerPartNumber\") AS mpn
  FROM \"CanonicalPart\" p JOIN \"SellerOffer\" o ON o.\"canonicalPartId\"=p.id JOIN \"Seller\" s ON s.id=o.\"sellerId\"
  WHERE p.brand ILIKE '%FEBEST%' AND s.name='Salvage Auto Parts' AND o.status='ACTIVE' AND p.\"manufacturerPartNumber\" IS NOT NULL
)
SELECT
  (SELECT COUNT(*) FROM sup) AS superior_mpns,
  (SELECT COUNT(*) FROM sal) AS salvage_mpns,
  (SELECT COUNT(*) FROM sal JOIN sup USING(mpn)) AS overlap;
"

echo
echo "==== Salvage FEBEST listings: how many have ebay URL / no MPN ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE p.\"ebayItemId\" IS NOT NULL) AS with_ebay,
  COUNT(*) FILTER (WHERE p.\"manufacturerPartNumber\" IS NULL) AS no_mpn,
  COUNT(*) FILTER (WHERE p.\"listingUrl\" ILIKE '%ebay.com%') AS ebay_url
FROM \"CanonicalPart\" p
JOIN \"SellerOffer\" o ON o.\"canonicalPartId\"=p.id JOIN \"Seller\" s ON s.id=o.\"sellerId\"
WHERE p.brand ILIKE '%FEBEST%' AND s.name='Salvage Auto Parts' AND o.status='ACTIVE';
"
