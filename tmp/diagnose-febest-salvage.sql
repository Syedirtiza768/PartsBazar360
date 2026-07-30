-- Check if these 68 FEBEST parts have offers from other sellers (FEBEST Inventory Supplier, Superior)
-- If yes, we only delete the Salvage/Blackline offers. If no, we delete the whole part.

-- First, let's see the breakdown
WITH salvage_febest_parts AS (
    SELECT DISTINCT p.id AS part_id
    FROM "CanonicalPart" p
    JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
    JOIN "Seller" s ON s.id = o."sellerId"
    WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
      AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%')
)
SELECT 
    s.name AS seller_name,
    COUNT(DISTINCT o.id) AS offer_count
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
WHERE o."canonicalPartId" IN (SELECT part_id FROM salvage_febest_parts)
GROUP BY s.name
ORDER BY offer_count DESC;

-- Check how many of the 68 parts have ONLY salvage/blackline offers (no other seller)
WITH salvage_febest_parts AS (
    SELECT DISTINCT p.id AS part_id
    FROM "CanonicalPart" p
    JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
    JOIN "Seller" s ON s.id = o."sellerId"
    WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
      AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%')
),
parts_with_other_offers AS (
    SELECT DISTINCT o."canonicalPartId" AS part_id
    FROM "SellerOffer" o
    JOIN "Seller" s ON s.id = o."sellerId"
    WHERE o."canonicalPartId" IN (SELECT part_id FROM salvage_febest_parts)
      AND s.name NOT ILIKE '%Blackline%'
      AND s.name NOT ILIKE '%Salvage%'
      AND s.name NOT ILIKE '%K. Salvage%'
)
SELECT 
    (SELECT COUNT(*) FROM salvage_febest_parts) AS total_febest_salvage,
    (SELECT COUNT(*) FROM parts_with_other_offers) AS parts_with_other_sellers,
    (SELECT COUNT(*) FROM salvage_febest_parts) - (SELECT COUNT(*) FROM parts_with_other_offers) AS orphan_parts_to_delete;

-- Show the offer IDs to be deleted (from Salvage/Blackline for FEBEST parts)
SELECT o.id AS offer_id, o."canonicalPartId" AS part_id, o.status, s.name AS seller_name, p.title
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
JOIN "CanonicalPart" p ON p.id = o."canonicalPartId"
WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
  AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%');