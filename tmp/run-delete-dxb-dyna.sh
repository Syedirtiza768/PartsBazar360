#!/bin/bash
set -eu

echo "Stop API to avoid locks"
docker stop partsbazar360-api-1 >/dev/null 2>&1 || true
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d postgres -c \
"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='partsbazar_db' AND pid<>pg_backend_pid();" || true
sleep 2

echo "=== BEFORE: upload jobs ==="
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT id, "fileName", status, "insertedRows", "createdAt"
FROM "SellerUploadJob"
WHERE "fileName" ILIKE '%DXB%'
   OR "fileName" ILIKE '%Dynatrade%'
   OR "fileName" ILIKE '%DYNATRADE%'
   OR COALESCE(detection::text, '') ILIKE '%DXB_EXW%'
   OR COALESCE(detection::text, '') ILIKE '%DYNATRADE_STOCK%'
ORDER BY "createdAt" DESC;
SQL

docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

CREATE TEMP TABLE target_jobs AS
SELECT id, "fileName", "sellerId"
FROM "SellerUploadJob"
WHERE "fileName" ILIKE '%DXB%'
   OR "fileName" ILIKE '%Dynatrade%'
   OR "fileName" ILIKE '%DYNATRADE%'
   OR COALESCE(detection::text, '') ILIKE '%DXB_EXW%'
   OR COALESCE(detection::text, '') ILIKE '%DYNATRADE_STOCK%'
   OR COALESCE(report::text, '') ILIKE '%DXB_EXW%'
   OR COALESCE(report::text, '') ILIKE '%DYNATRADE_STOCK%';

CREATE TEMP TABLE target_offers AS
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
    OR COALESCE(sr."rawPayload"->>'__template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK')
  );

CREATE TEMP TABLE target_parts AS
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
    OR COALESCE(sr."rawPayload"->>'__template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK')
  )
UNION
SELECT DISTINCT o."canonicalPartId"
FROM "SellerOffer" o
JOIN target_offers t ON t.offer_id = o.id
WHERE o."canonicalPartId" IS NOT NULL;

SELECT 'jobs' AS k, COUNT(*)::bigint AS n FROM target_jobs
UNION ALL SELECT 'offers', COUNT(*) FROM target_offers
UNION ALL SELECT 'part_candidates', COUNT(*) FROM target_parts;

-- Ensure helpful indexes exist
CREATE INDEX IF NOT EXISTS "SellerOffer_sellerId_idx" ON "SellerOffer" ("sellerId");
CREATE INDEX IF NOT EXISTS "Inventory_offerId_idx" ON "Inventory" ("offerId");
CREATE INDEX IF NOT EXISTS "OfferPrice_offerId_idx" ON "OfferPrice" ("offerId");
CREATE INDEX IF NOT EXISTS "CartItem_sellerOfferId_idx" ON "CartItem" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "OrderItem_sellerOfferId_idx" ON "OrderItem" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SalvageUnit_sellerOfferId_idx" ON "SalvageUnit" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SellerUploadRow_sellerOfferId_idx" ON "SellerUploadRow" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SourceRecord_sellerOfferId_idx" ON "SourceRecord" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "Fitment_canonicalPartId_idx" ON "Fitment" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "CatalogPartNumber_canonicalPartId_idx" ON "CatalogPartNumber" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "ProductMedia_canonicalPartId_idx" ON "ProductMedia" ("canonicalPartId");

UPDATE "SellerUploadRow" SET "sellerOfferId" = NULL WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);
UPDATE "SourceRecord" SET "sellerOfferId" = NULL WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);
UPDATE "SupportTicket" SET "sellerOfferId" = NULL WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);

DELETE FROM "CartItem" WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "OrderItem" WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "SalvageUnit" WHERE "sellerOfferId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "Inventory" WHERE "offerId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "OfferPrice" WHERE "offerId" IN (SELECT offer_id FROM target_offers);
DELETE FROM "SellerOffer" WHERE id IN (SELECT offer_id FROM target_offers);

DELETE FROM "SourceRecord"
WHERE "sourceFileName" ILIKE '%DXB%'
   OR "sourceFileName" ILIKE '%Dynatrade%'
   OR "sourceFileName" ILIKE '%DYNATRADE%'
   OR COALESCE(transformations->>'template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK')
   OR COALESCE("rawPayload"->>'__template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK');

DELETE FROM "SellerUploadJob" WHERE id IN (SELECT id FROM target_jobs);

CREATE TEMP TABLE orphan_parts AS
SELECT p.part_id
FROM target_parts p
WHERE p.part_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = p.part_id)
  AND NOT EXISTS (SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId" = p.part_id);

SELECT 'orphans' AS k, COUNT(*)::bigint AS n FROM orphan_parts;

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
WHERE "fromPartId" IN (SELECT part_id FROM orphan_parts) OR "toPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT part_id FROM orphan_parts);
DELETE FROM "CanonicalPart" WHERE id IN (SELECT part_id FROM orphan_parts);

COMMIT;
SQL

echo "=== AFTER ==="
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT COUNT(*) AS dxb_dyna_jobs_left
FROM "SellerUploadJob"
WHERE "fileName" ILIKE '%DXB%'
   OR "fileName" ILIKE '%Dynatrade%'
   OR "fileName" ILIKE '%DYNATRADE%';

SELECT COUNT(*) AS dxb_dyna_sources_left
FROM "SourceRecord"
WHERE "sourceFileName" ILIKE '%DXB%'
   OR "sourceFileName" ILIKE '%Dynatrade%'
   OR "sourceFileName" ILIKE '%DYNATRADE%'
   OR COALESCE(transformations->>'template', '') IN ('DXB_EXW', 'DYNATRADE_STOCK');

-- FEBEST should remain
SELECT id, "fileName", status, "insertedRows"
FROM "SellerUploadJob"
WHERE "fileName" ILIKE '%FEBEST%' OR "fileName" ILIKE '%febest%'
ORDER BY "createdAt" DESC
LIMIT 10;
SQL

docker start partsbazar360-api-1 >/dev/null 2>&1 || true
sleep 5
docker ps --filter name=partsbazar360-api --format '{{.Names}} {{.Status}}'
echo DONE
