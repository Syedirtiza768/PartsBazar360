-- SAFE CLEANUP: Delete all FEBEST-branded parts that only have Salvage/Blackline offers.
-- These are parts that got re-ingested by the RealTrack sync after the wipe.
-- FEBEST parts should only come through the FEBEST Inventory Supplier / spreadsheet pipeline.

BEGIN;

-- Target FEBEST parts that have Salvage/Blackline offers
CREATE TEMP TABLE febest_salvage_parts ON COMMIT DROP AS
SELECT DISTINCT p.id AS part_id
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
  AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%');

-- Get the offer IDs from these sellers for these parts
CREATE TEMP TABLE febest_salvage_offers ON COMMIT DROP AS
SELECT o.id AS offer_id
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
JOIN febest_salvage_parts fp ON fp.part_id = o."canonicalPartId"
WHERE s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%';

-- Count what we're deleting
SELECT 'febest_salvage_offers' AS kind, COUNT(*)::bigint AS n FROM febest_salvage_offers;
SELECT 'febest_salvage_parts' AS kind, COUNT(*)::bigint AS n FROM febest_salvage_parts;

-- Check if any of these parts have offers from OTHER sellers (should be 0 per diagnosis)
SELECT COUNT(DISTINCT o."canonicalPartId") AS parts_with_other_offers
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
WHERE o."canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts)
  AND s.name NOT ILIKE '%Blackline%'
  AND s.name NOT ILIKE '%Salvage%'
  AND s.name NOT ILIKE '%K. Salvage%';

-- Delete the Salvage/Blackline offers for these parts
DELETE FROM "CartItem" WHERE "sellerOfferId" IN (SELECT offer_id FROM febest_salvage_offers);
DELETE FROM "OrderItem" WHERE "sellerOfferId" IN (SELECT offer_id FROM febest_salvage_offers);
DELETE FROM "SalvageUnit" WHERE "sellerOfferId" IN (SELECT offer_id FROM febest_salvage_offers);
DELETE FROM "Inventory" WHERE "offerId" IN (SELECT offer_id FROM febest_salvage_offers);
DELETE FROM "OfferPrice" WHERE "offerId" IN (SELECT offer_id FROM febest_salvage_offers);
DELETE FROM "SellerOffer" WHERE id IN (SELECT offer_id FROM febest_salvage_offers);

-- Now delete orphan CanonicalParts (no remaining offers from any seller)
DELETE FROM "FitmentEvidence"
WHERE "fitmentId" IN (
  SELECT f.id FROM "Fitment" f WHERE f."canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts)
);
DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);
DELETE FROM "CatalogPartNumber" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);
DELETE FROM "ProductMedia" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);
DELETE FROM "SalvageUnit" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);
DELETE FROM "CanonicalPartRedirect"
WHERE "fromPartId" IN (SELECT part_id FROM febest_salvage_parts)
   OR "toPartId" IN (SELECT part_id FROM febest_salvage_parts);
DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);

UPDATE "SourceRecord" SET "canonicalPartId" = NULL, "sellerOfferId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);
UPDATE "SellerUploadRow" SET "canonicalPartId" = NULL, "sellerOfferId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);
UPDATE "SupportTicket" SET "canonicalPartId" = NULL, "sellerOfferId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);
UPDATE "ReviewTask" SET "canonicalPartId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM febest_salvage_parts);

DELETE FROM "CanonicalPart" WHERE id IN (SELECT part_id FROM febest_salvage_parts);

-- Verify: should be 0 FEBEST parts from Salvage/Blackline
SELECT COUNT(*) AS remaining_febest_salvage
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
  AND (s.name ILIKE '%Blackline%' OR s.name ILIKE '%Salvage%' OR s.name ILIKE '%K. Salvage%');

COMMIT;