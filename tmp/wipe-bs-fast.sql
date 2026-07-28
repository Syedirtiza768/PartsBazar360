-- Batched wipe of Blackline + Salvage offers and orphan parts (run AFTER indexes).

CREATE TEMP TABLE target_sellers AS
SELECT id, name, "storeId"
FROM "Seller"
WHERE name ILIKE '%Blackline%'
   OR name IN ('Salvage Auto Parts', 'K. Salvage Auto Parts')
   OR id IN ('seller-salvage-auto-parts', 'seller-blackline-auto-parts')
   OR "storeId" IN (
     'd16199c4-55b5-429e-ad27-892bed94e00d',
     '3b84b063-3811-481f-a61d-f7846a03558f',
     'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
   );

CREATE TEMP TABLE target_offer_ids AS
SELECT o.id
FROM "SellerOffer" o
JOIN target_sellers s ON s.id = o."sellerId";

CREATE TEMP TABLE target_part_ids AS
SELECT DISTINCT o."canonicalPartId" AS id
FROM "SellerOffer" o
JOIN target_sellers s ON s.id = o."sellerId"
WHERE o."canonicalPartId" IS NOT NULL;

SELECT 'sellers' AS k, COUNT(*)::bigint AS n FROM target_sellers
UNION ALL SELECT 'offers', COUNT(*) FROM target_offer_ids
UNION ALL SELECT 'parts', COUNT(*) FROM target_part_ids;

-- Null FKs in one shot
UPDATE "SellerUploadRow" SET "sellerOfferId" = NULL WHERE "sellerOfferId" IN (SELECT id FROM target_offer_ids);
UPDATE "SourceRecord" SET "sellerOfferId" = NULL WHERE "sellerOfferId" IN (SELECT id FROM target_offer_ids);
UPDATE "SupportTicket" SET "sellerOfferId" = NULL WHERE "sellerOfferId" IN (SELECT id FROM target_offer_ids);

DELETE FROM "CartItem" WHERE "sellerOfferId" IN (SELECT id FROM target_offer_ids);
DELETE FROM "OrderItem" WHERE "sellerOfferId" IN (SELECT id FROM target_offer_ids);
DELETE FROM "SalvageUnit" WHERE "sellerOfferId" IN (SELECT id FROM target_offer_ids);
DELETE FROM "Inventory" WHERE "offerId" IN (SELECT id FROM target_offer_ids);
DELETE FROM "OfferPrice" WHERE "offerId" IN (SELECT id FROM target_offer_ids);

-- Delete offers (should be fast with indexes)
DELETE FROM "SellerOffer" WHERE id IN (SELECT id FROM target_offer_ids);

DELETE FROM "RawStagingListing"
WHERE "storeId" IN (SELECT "storeId" FROM target_sellers WHERE "storeId" IS NOT NULL);

-- Orphans: parts with no remaining offers/upload rows
CREATE TEMP TABLE orphan_parts AS
SELECT p.id
FROM target_part_ids p
WHERE NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId" = p.id);

SELECT 'orphans' AS k, COUNT(*)::bigint AS n FROM orphan_parts;

UPDATE "SourceRecord" SET "canonicalPartId" = NULL WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
UPDATE "SellerUploadRow" SET "canonicalPartId" = NULL WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
UPDATE "SupportTicket" SET "canonicalPartId" = NULL WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
UPDATE "ReviewTask" SET "canonicalPartId" = NULL WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);

DELETE FROM "FitmentEvidence"
WHERE "fitmentId" IN (SELECT f.id FROM "Fitment" f WHERE f."canonicalPartId" IN (SELECT id FROM orphan_parts));
DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "CatalogPartNumber" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "ProductMedia" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "SalvageUnit" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "CanonicalPartRedirect"
WHERE "fromPartId" IN (SELECT id FROM orphan_parts) OR "toPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "CanonicalPart" WHERE id IN (SELECT id FROM orphan_parts);

SELECT s.name, COUNT(o.id) AS offers_left
FROM target_sellers s
LEFT JOIN "SellerOffer" o ON o."sellerId" = s.id
GROUP BY s.name
ORDER BY s.name;
