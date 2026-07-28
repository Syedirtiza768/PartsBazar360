-- Remove Dynatrade + DXB spreadsheet imports only (keep FEBEST + RealTrack).
-- Safe to run inside a transaction.

BEGIN;

CREATE TEMP TABLE target_jobs ON COMMIT DROP AS
SELECT id, "fileName", "sellerId"
FROM "SellerUploadJob"
WHERE "fileName" ILIKE '%DXB%'
   OR "fileName" ILIKE '%Dynatrade%'
   OR "fileName" ILIKE '%DYNATRADE%'
   OR COALESCE(detection::text, '') ILIKE '%DXB_EXW%'
   OR COALESCE(detection::text, '') ILIKE '%DYNATRADE_STOCK%'
   OR COALESCE(report::text, '') ILIKE '%DXB_EXW%'
   OR COALESCE(report::text, '') ILIKE '%DYNATRADE_STOCK%';

CREATE TEMP TABLE target_offers ON COMMIT DROP AS
SELECT DISTINCT r."sellerOfferId" AS offer_id
FROM "SellerUploadRow" r
JOIN target_jobs j ON j.id = r."uploadJobId"
WHERE r."sellerOfferId" IS NOT NULL
UNION
SELECT DISTINCT sr."sellerOfferId"
FROM "SourceRecord" sr
WHERE sr."sellerOfferId" IS NOT NULL
  AND (
    sr."sourceFileName" ILIKE '%DXB%'
    OR sr."sourceFileName" ILIKE '%Dynatrade%'
    OR sr."sourceFileName" ILIKE '%DYNATRADE%'
    OR COALESCE(sr.transformations->>'template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK')
    OR COALESCE(sr.rawPayload->>'__template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK')
  );

CREATE TEMP TABLE target_parts ON COMMIT DROP AS
SELECT DISTINCT r."canonicalPartId" AS part_id
FROM "SellerUploadRow" r
JOIN target_jobs j ON j.id = r."uploadJobId"
WHERE r."canonicalPartId" IS NOT NULL
UNION
SELECT DISTINCT sr."canonicalPartId"
FROM "SourceRecord" sr
WHERE sr."canonicalPartId" IS NOT NULL
  AND (
    sr."sourceFileName" ILIKE '%DXB%'
    OR sr."sourceFileName" ILIKE '%Dynatrade%'
    OR sr."sourceFileName" ILIKE '%DYNATRADE%'
    OR COALESCE(sr.transformations->>'template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK')
    OR COALESCE(sr.rawPayload->>'__template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK')
  )
UNION
SELECT DISTINCT o."canonicalPartId"
FROM "SellerOffer" o
JOIN target_offers t ON t.offer_id = o.id
WHERE o."canonicalPartId" IS NOT NULL;

-- Preview counts before delete
SELECT 'jobs' AS kind, COUNT(*)::bigint AS n FROM target_jobs
UNION ALL SELECT 'offers', COUNT(*) FROM target_offers
UNION ALL SELECT 'candidate_parts', COUNT(*) FROM target_parts;

-- Null FKs that block offer delete
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

-- Delete source evidence for DXB/Dynatrade
DELETE FROM "SourceRecord"
WHERE "sourceFileName" ILIKE '%DXB%'
   OR "sourceFileName" ILIKE '%Dynatrade%'
   OR "sourceFileName" ILIKE '%DYNATRADE%'
   OR COALESCE(transformations->>'template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK')
   OR COALESCE("rawPayload"->>'__template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK');

-- Upload jobs cascade to rows
DELETE FROM "SellerUploadJob" WHERE id IN (SELECT id FROM target_jobs);

-- Delete canonical parts that no longer have any offers (DXB/Dynatrade orphans only)
CREATE TEMP TABLE orphan_parts ON COMMIT DROP AS
SELECT p.part_id
FROM target_parts p
WHERE p.part_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = p.part_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId" = p.part_id
  );

UPDATE "SourceRecord" SET "canonicalPartId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);

UPDATE "SellerUploadRow" SET "canonicalPartId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);

UPDATE "SupportTicket" SET "canonicalPartId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);

UPDATE "ReviewTask" SET "canonicalPartId" = NULL
WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);

DELETE FROM "FitmentEvidence"
WHERE "fitmentId" IN (
  SELECT f.id FROM "Fitment" f WHERE f."canonicalPartId" IN (SELECT part_id FROM orphan_parts)
);
DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "CatalogPartNumber" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "ProductMedia" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "SalvageUnit" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "CanonicalPartRedirect" WHERE "fromPartId" IN (SELECT part_id FROM orphan_parts) OR "toPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "CanonicalPart" WHERE id IN (SELECT part_id FROM orphan_parts);

SELECT 'deleted_orphan_parts' AS kind, COUNT(*)::bigint AS n FROM orphan_parts;

COMMIT;
