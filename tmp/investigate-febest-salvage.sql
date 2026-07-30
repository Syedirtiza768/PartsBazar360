-- Investigate FEBEST parts coming from Salvage/Blackline sellers
-- Step 1: Check the specific part from the URL
SELECT p.id, p.title, p.brand, p."partSource", p."partType", p."listingUrl", p."ebayItemId",
       s.name as seller_name, s.id as seller_id, s."storeId",
       o.id as offer_id, o.status as offer_status
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE p.id = '6583906a-e470-467e-8a27-969468e8d90e';

-- Step 2: Count ALL FEBEST-branded parts that belong to Salvage/Blackline sellers
SELECT s.name as seller_name, COUNT(DISTINCT p.id) as part_count
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
  AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%')
GROUP BY s.name;

-- Step 3: Total count of FEBEST parts with Salvage/Blackline offers
SELECT COUNT(DISTINCT p.id) as total_febest_salvage_parts
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
  AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%');

-- Step 4: Check total FEBEST parts and their sellers
SELECT s.name as seller_name, COUNT(DISTINCT p.id) as part_count
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
GROUP BY s.name
ORDER BY part_count DESC;