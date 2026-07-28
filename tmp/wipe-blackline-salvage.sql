-- Wipe Blackline Auto Parts + Salvage Auto Parts (marketplace + K. Salvage leftovers).
-- Does NOT touch Superior / FEBEST / DXB / Dynatrade / other RealTrack stores.

BEGIN;

CREATE TEMP TABLE target_sellers ON COMMIT DROP AS
SELECT id, name, "storeId"
FROM "Seller"
WHERE name ILIKE '%Blackline%'
   OR name = 'Salvage Auto Parts'
   OR name = 'K. Salvage Auto Parts'
   OR id IN ('seller-salvage-auto-parts', 'seller-blackline-auto-parts')
   OR "storeId" IN (
     'd16199c4-55b5-429e-ad27-892bed94e00d', -- Blackline
     '3b84b063-3811-481f-a61d-f7846a03558f', -- US SalvageA
     'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'  -- K. Salvage
   );

SELECT 'sellers' AS kind, COUNT(*)::bigint AS n FROM target_sellers;
SELECT id, name, "storeId" FROM target_sellers ORDER BY name;

CREATE TEMP TABLE target_offers ON COMMIT DROP AS
SELECT o.id AS offer_id, o."canonicalPartId" AS part_id
FROM "SellerOffer" o
JOIN target_sellers s ON s.id = o."sellerId";

SELECT 'offers' AS kind, COUNT(*)::bigint AS n FROM target_offers;
SELECT 'distinct_parts' AS kind, COUNT(DISTINCT part_id)::bigint AS n FROM target_offers;

-- Clear FKs
UPDATE "SellerUploadRow" SET "sellerOfferId" = NULL
WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);

UPDATE "SourceRecord" SET "sellerOfferId" = NULL
WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);

UPDATE "SupportTicket" SET "sellerOfferId" = NULL
WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);

DELETE FROM "CartItem" WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "OrderItem" WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "SalvageUnit" WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "Inventory" WHERE "offerId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "OfferPrice" WHERE "offerId" IN (SELECT offer_id FROM target_offers);

DELETE FROM "SellerOffer" WHERE id IN (SELECT offer_id FROM target_offers);

-- Staging for these RealTrack stores
DELETE FROM "RawStagingListing"
WHERE "storeId" IN (
  SELECT "storeId" FROM target_sellers WHERE "storeId" IS NOT NULL
);

-- Orphan parts that no longer have any offers
CREATE TEMP TABLE orphan_parts ON COMMIT DROP AS
SELECT DISTINCT t.part_id
FROM target_offers t
WHERE t.part_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = t.part_id)
  AND NOT EXISTS (SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId" = t.part_id);

SELECT 'orphan_parts' AS kind, COUNT(*)::bigint AS n FROM orphan_parts;

UPDATE "SourceRecord" SET "canonicalPartId" = NULL WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
UPDATE "SellerUploadRow" SET "canonicalPartId" = NULL WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
UPDATE "SupportTicket" SET "canonicalPartId" = NULL WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
UPDATE "ReviewTask" SET "canonicalPartId" = NULL WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);

DELETE FROM "FitmentEvidence"
WHERE "fitmentId" IN (SELECT f.id FROM "Fitment" f WHERE f."canonicalPartId" IN (SELECT part_id FROM orphan_parts));
DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "CatalogPartNumber" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "ProductMedia" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "SalvageUnit" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "CanonicalPartRedirect"
WHERE "fromPartId" IN (SELECT part_id FROM orphan_parts)
   OR "toPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "CanonicalPart" WHERE id IN (SELECT part_id FROM orphan_parts);

-- Verify
SELECT s.name, COUNT(o.id) AS offers_left
FROM target_sellers s
LEFT JOIN "SellerOffer" o ON o."sellerId" = s.id
GROUP BY s.name
ORDER BY s.name;

COMMIT;
