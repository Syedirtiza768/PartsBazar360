-- Verify the specific part still exists
SELECT p.id, p.title, p.brand
FROM "CanonicalPart" p
WHERE p.id = '6583906a-e470-467e-8a27-969468e8d90e';

-- Count remaining FEBEST parts with salvage/blackline offers
SELECT COUNT(DISTINCT p.id) AS remaining
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
  AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%');

-- Check all offers for this specific part
SELECT o.id, o.status, s.name as seller_name
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
WHERE o."canonicalPartId" = '6583906a-e470-467e-8a27-969468e8d90e';
