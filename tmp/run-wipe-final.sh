#!/bin/bash
set -eu

echo "Stop API if running"
docker stop partsbazar360-api-1 >/dev/null 2>&1 || true
pkill -f run-wipe-dropfk.sh || true
pkill -f run-wipe-fast.sh || true

echo "Kill ALL app DB sessions"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'partsbazar_db'
  AND pid <> pg_backend_pid();
SQL
sleep 3

echo "Batched sellerId deletes"
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 <<'SQL'
-- Ensure RESTRICT FKs are dropped (idempotent)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = '"SellerOffer"'::regclass
      AND c.conrelid::regclass::text IN ('"Inventory"','"CartItem"','"OrderItem"','"SalvageUnit"')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

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

SELECT 'sellers' AS k, COUNT(*) FROM target_sellers;
SELECT 'offers_before' AS k, COUNT(*) FROM "SellerOffer" o JOIN target_sellers s ON s.id = o."sellerId";

-- dependents
DELETE FROM "CartItem" c USING "SellerOffer" o, target_sellers s WHERE c."sellerOfferId"=o.id AND o."sellerId"=s.id;
DELETE FROM "OrderItem" oi USING "SellerOffer" o, target_sellers s WHERE oi."sellerOfferId"=o.id AND o."sellerId"=s.id;
DELETE FROM "SalvageUnit" su USING "SellerOffer" o, target_sellers s WHERE su."sellerOfferId"=o.id AND o."sellerId"=s.id;
DELETE FROM "Inventory" i USING "SellerOffer" o, target_sellers s WHERE i."offerId"=o.id AND o."sellerId"=s.id;
DELETE FROM "OfferPrice" p USING "SellerOffer" o, target_sellers s WHERE p."offerId"=o.id AND o."sellerId"=s.id;
UPDATE "SellerUploadRow" r SET "sellerOfferId"=NULL FROM "SellerOffer" o, target_sellers s WHERE r."sellerOfferId"=o.id AND o."sellerId"=s.id;
UPDATE "SourceRecord" sr SET "sellerOfferId"=NULL FROM "SellerOffer" o, target_sellers s WHERE sr."sellerOfferId"=o.id AND o."sellerId"=s.id;
UPDATE "SupportTicket" t SET "sellerOfferId"=NULL FROM "SellerOffer" o, target_sellers s WHERE t."sellerOfferId"=o.id AND o."sellerId"=s.id;

-- capture parts before offer delete
CREATE TEMP TABLE target_parts AS
SELECT DISTINCT o."canonicalPartId" AS id
FROM "SellerOffer" o JOIN target_sellers s ON s.id=o."sellerId"
WHERE o."canonicalPartId" IS NOT NULL;

-- delete offers in chunks via ctid
DO $$
DECLARE n int;
BEGIN
  LOOP
    DELETE FROM "SellerOffer" WHERE ctid IN (
      SELECT o.ctid FROM "SellerOffer" o
      JOIN target_sellers s ON s.id = o."sellerId"
      LIMIT 5000
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'deleted_offers_batch %', n;
    EXIT WHEN n = 0;
  END LOOP;
END $$;

SELECT 'offers_after' AS k, COUNT(*) FROM "SellerOffer" o JOIN target_sellers s ON s.id = o."sellerId";

-- recreate FKs
ALTER TABLE "Inventory" DROP CONSTRAINT IF EXISTS "Inventory_offerId_fkey";
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_sellerOfferId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_sellerOfferId_fkey";
ALTER TABLE "SalvageUnit" DROP CONSTRAINT IF EXISTS "SalvageUnit_sellerOfferId_fkey";

ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SalvageUnit" ADD CONSTRAINT "SalvageUnit_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

DELETE FROM "RawStagingListing" WHERE "storeId" IN (SELECT "storeId" FROM target_sellers WHERE "storeId" IS NOT NULL);

CREATE TEMP TABLE orphan_parts AS
SELECT p.id FROM target_parts p
WHERE NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id)
  AND NOT EXISTS (SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId"=p.id);

SELECT 'orphans' AS k, COUNT(*) FROM orphan_parts;

UPDATE "SourceRecord" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
UPDATE "SellerUploadRow" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
UPDATE "SupportTicket" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
UPDATE "ReviewTask" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);

DELETE FROM "FitmentEvidence" WHERE "fitmentId" IN (SELECT f.id FROM "Fitment" f WHERE f."canonicalPartId" IN (SELECT id FROM orphan_parts));
DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "CatalogPartNumber" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "ProductMedia" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "SalvageUnit" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "CanonicalPartRedirect" WHERE "fromPartId" IN (SELECT id FROM orphan_parts) OR "toPartId" IN (SELECT id FROM orphan_parts);
DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT id FROM orphan_parts);

DO $$
DECLARE n int;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM orphan_parts LIMIT 5000
    ),
    del AS (
      DELETE FROM "CanonicalPart" cp USING batch b WHERE cp.id = b.id RETURNING cp.id
    )
    DELETE FROM orphan_parts op USING del d WHERE op.id = d.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'deleted_parts_batch %', n;
    EXIT WHEN n = 0;
  END LOOP;
END $$;

SELECT s.name, COUNT(o.id) AS offers_left
FROM target_sellers s
LEFT JOIN "SellerOffer" o ON o."sellerId"=s.id
GROUP BY s.name ORDER BY s.name;
SQL

echo VERIFY
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.name, COUNT(o.id) AS offers_left FROM \"Seller\" s LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\"=s.id WHERE s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0') GROUP BY s.name ORDER BY s.name;"

echo "Restart API"
docker start partsbazar360-api-1
sleep 5
docker ps --filter name=partsbazar360-api --format '{{.Names}} {{.Status}}'
echo DONE
