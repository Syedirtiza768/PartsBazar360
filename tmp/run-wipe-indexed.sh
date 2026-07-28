#!/bin/bash
set -eu
docker stop partsbazar360-api-1 >/dev/null 2>&1 || true
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d postgres -c \
"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='partsbazar_db' AND pid<>pg_backend_pid();" || true
sleep 1

docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 <<'SQL'
SELECT s.id, s.name, COUNT(o.id) AS offers
FROM "Seller" s
LEFT JOIN "SellerOffer" o ON o."sellerId"=s.id
WHERE s.id IN (
  'seller-salvage-auto-parts',
  '79aa9032-e0af-4836-bf19-100bd922c7ae',
  '21924d3c-b345-4dcd-900c-b4bcf92b01c0'
)
GROUP BY s.id, s.name;

CREATE INDEX IF NOT EXISTS "SellerOffer_sellerId_idx" ON "SellerOffer" ("sellerId");
CREATE INDEX IF NOT EXISTS "SellerOffer_canonicalPartId_idx" ON "SellerOffer" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SourceRecord_sellerOfferId_idx" ON "SourceRecord" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SellerUploadRow_sellerOfferId_idx" ON "SellerUploadRow" ("sellerOfferId");

ALTER TABLE "Inventory" DROP CONSTRAINT IF EXISTS "Inventory_offerId_fkey";
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_sellerOfferId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_sellerOfferId_fkey";
ALTER TABLE "SalvageUnit" DROP CONSTRAINT IF EXISTS "SalvageUnit_sellerOfferId_fkey";

-- mark parts
DROP TABLE IF EXISTS tmp_wipe_parts;
CREATE TABLE tmp_wipe_parts AS
SELECT DISTINCT "canonicalPartId" AS id
FROM "SellerOffer"
WHERE "sellerId" IN (
  'seller-salvage-auto-parts',
  '79aa9032-e0af-4836-bf19-100bd922c7ae',
  '21924d3c-b345-4dcd-900c-b4bcf92b01c0'
) AND "canonicalPartId" IS NOT NULL;

SELECT COUNT(*) AS parts_to_remove FROM tmp_wipe_parts;

DELETE FROM "Inventory" WHERE "offerId" IN (
  SELECT id FROM "SellerOffer" WHERE "sellerId" IN (
    'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0'));
DELETE FROM "OfferPrice" WHERE "offerId" IN (
  SELECT id FROM "SellerOffer" WHERE "sellerId" IN (
    'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0'));
DELETE FROM "CartItem" WHERE "sellerOfferId" IN (
  SELECT id FROM "SellerOffer" WHERE "sellerId" IN (
    'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0'));
DELETE FROM "OrderItem" WHERE "sellerOfferId" IN (
  SELECT id FROM "SellerOffer" WHERE "sellerId" IN (
    'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0'));
DELETE FROM "SalvageUnit" WHERE "sellerOfferId" IN (
  SELECT id FROM "SellerOffer" WHERE "sellerId" IN (
    'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0'));
UPDATE "SellerUploadRow" SET "sellerOfferId"=NULL WHERE "sellerOfferId" IN (
  SELECT id FROM "SellerOffer" WHERE "sellerId" IN (
    'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0'));
UPDATE "SourceRecord" SET "sellerOfferId"=NULL WHERE "sellerOfferId" IN (
  SELECT id FROM "SellerOffer" WHERE "sellerId" IN (
    'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0'));
UPDATE "SupportTicket" SET "sellerOfferId"=NULL WHERE "sellerOfferId" IN (
  SELECT id FROM "SellerOffer" WHERE "sellerId" IN (
    'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0'));

DELETE FROM "SellerOffer" WHERE "sellerId" IN (
  'seller-salvage-auto-parts',
  '79aa9032-e0af-4836-bf19-100bd922c7ae',
  '21924d3c-b345-4dcd-900c-b4bcf92b01c0'
);

SELECT 'offers_left' AS k, COUNT(*) FROM "SellerOffer" WHERE "sellerId" IN (
  'seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0');

ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SalvageUnit" ADD CONSTRAINT "SalvageUnit_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

DELETE FROM "RawStagingListing" WHERE "storeId" IN (
  'd16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0');

DELETE FROM tmp_wipe_parts p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id)
   OR EXISTS (SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId"=p.id);

SELECT COUNT(*) AS orphans FROM tmp_wipe_parts;

UPDATE "SourceRecord" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
UPDATE "SellerUploadRow" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
UPDATE "SupportTicket" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
UPDATE "ReviewTask" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
DELETE FROM "FitmentEvidence" WHERE "fitmentId" IN (SELECT f.id FROM "Fitment" f WHERE f."canonicalPartId" IN (SELECT id FROM tmp_wipe_parts));
DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
DELETE FROM "CatalogPartNumber" WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
DELETE FROM "ProductMedia" WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
DELETE FROM "SalvageUnit" WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
DELETE FROM "CanonicalPartRedirect" WHERE "fromPartId" IN (SELECT id FROM tmp_wipe_parts) OR "toPartId" IN (SELECT id FROM tmp_wipe_parts);
DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT id FROM tmp_wipe_parts);
DELETE FROM "CanonicalPart" WHERE id IN (SELECT id FROM tmp_wipe_parts);
DROP TABLE tmp_wipe_parts;

SELECT s.id, s.name, COUNT(o.id) AS offers
FROM "Seller" s
LEFT JOIN "SellerOffer" o ON o."sellerId"=s.id
WHERE s.id IN (
  'seller-salvage-auto-parts',
  '79aa9032-e0af-4836-bf19-100bd922c7ae',
  '21924d3c-b345-4dcd-900c-b4bcf92b01c0'
)
GROUP BY s.id, s.name
ORDER BY s.name;
SQL

docker start partsbazar360-api-1
sleep 5
docker ps --filter name=partsbazar360-api --format '{{.Names}} {{.Status}}'
echo DONE
