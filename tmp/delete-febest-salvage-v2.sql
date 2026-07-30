-- Re-run: Delete ALL parts with FEBEST in title that have Salvage/Blackline offers
-- The earlier run may have been lost due to container restart

BEGIN;

-- Find ALL parts with FEBEST in title (not brand) that have salvage/blackline offers
CREATE TEMP TABLE febest_salvage_parts_v2 ON COMMIT DROP AS
SELECT DISTINCT p.id AS part_id
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE (
    UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
    OR UPPER(p.title) LIKE '%FEBEST%'
  )
  AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%');

SELECT 'parts_to_delete' AS kind, COUNT(*)::bigint AS n FROM febest_salvage_parts_v2;

-- Check which have other offers
SELECT COUNT(DISTINCT o."canonicalPartId") AS parts_with_other_offers
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
WHERE o."canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2)
  AND s.name NOT ILIKE '%Blackline%'
  AND s.name NOT ILIKE '%Salvage%'
  AND s.name NOT ILIKE '%K. Salvage%';

-- Get all offer IDs
CREATE TEMP TABLE febest_salvage_offers_v2 ON COMMIT DROP AS
SELECT o.id AS offer_id
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
JOIN febest_salvage_parts_v2 fp ON fp.part_id = o."canonicalPartId"
WHERE s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%';

SELECT 'offers_to_delete' AS kind, COUNT(*)::bigint AS n FROM febest_salvage_offers_v2;

-- Delete FK references first
DELETE FROM "CartItem" WHERE "sellerOfferId" IN (SELECT offer_id FROM febest_salvage_offers_v2);
DELETE FROM "OrderItem" WHERE "sellerOfferId" IN (SELECT offer_id FROM febest_salvage_offers_v2);
DELETE FROM "SalvageUnit" WHERE "sellerOfferId" IN (SELECT offer_id FROM febest_salvage_offers_v2);
DELETE FROM "Inventory" WHERE "offerId" IN (SELECT offer_id FROM febest_salvage_offers_v2);
DELETE FROM "OfferPrice" WHERE "offerId" IN (SELECT offer_id FROM febest_salvage_offers_v2);

-- Delete the salvage/blackline offers
DELETE FROM "SellerOffer" WHERE id IN (SELECT offer_id FROM febest_salvage_offers_v2);

-- Delete orphan parts (no remaining offers from any seller)
DELETE FROM "FitmentEvidence"
WHERE "fitmentId" IN (
  SELECT f.id FROM "Fitment" f WHERE f."canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2)
);
DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);
DELETE FROM "CatalogPartNumber" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);
DELETE FROM "ProductMedia" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);
DELETE FROM "SalvageUnit" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);
DELETE FROM "CanonicalPartRedirect"
WHERE "fromPartId" IN (SELECT part_id FROM febest_salvage_parts_v2)
   OR "toPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);
DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);

UPDATE "SourceRecord" SET "canonicalPartId" = NULL, "sellerOfferId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);
UPDATE "SellerUploadRow" SET "canonicalPartId" = NULL, "sellerOfferId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);
UPDATE "SupportTicket" SET "canonicalPartId" = NULL, "sellerOfferId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);
UPDATE "ReviewTask" SET "canonicalPartId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts_v2);

-- Now only delete parts that have no remaining offers from ANY seller
CREATE TEMP TABLE orphan_parts_v2 ON COMMIT DROP AS
SELECT p.part_id
FROM febest_salvage_parts_v2 p
WHERE NOT EXISTS (
  SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = p.part_id
);

SELECT 'orphan_parts_to_delete' AS kind, COUNT(*)::bigint AS n FROM orphan_parts_v2;

DELETE FROM "CanonicalPart" WHERE id IN (SELECT part_id FROM orphan_parts_v2);

-- Final verification
SELECT 'remaining_febest_salvage' AS kind, COUNT(*)::bigint AS n
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE (UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%' OR UPPER(p.title) LIKE '%FEBEST%')
  AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%');

-- Also check the specific part
SELECT EXISTS(
  SELECT 1 FROM "CanonicalPart" WHERE id = '6583906a-e470-467e-8a27-969468e8d90e'
) AS specific_part_still_exists;

COMMIT;
