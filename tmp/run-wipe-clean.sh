#!/bin/bash
set -eu

pkill -f run-wipe-final.sh || true
pkill -f run-wipe-dropfk.sh || true
# kill docker exec psql wrappers
pkill -f 'psql -U partsbazar_user' || true
sleep 1

docker stop partsbazar360-api-1 >/dev/null 2>&1 || true

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d postgres <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'partsbazar_db'
  AND pid <> pg_backend_pid();
SQL
sleep 2

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT count(*) AS remaining_sessions FROM pg_stat_activity WHERE datname='partsbazar_db' AND pid <> pg_backend_pid();"

echo "Offers remaining for target sellers:"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.name, COUNT(o.id) FROM \"Seller\" s LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\"=s.id WHERE s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0') GROUP BY s.name;"

# Drop restrict FKs if still present
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
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
    RAISE NOTICE 'dropped % on %', r.conname, r.tbl;
  END LOOP;
END $$;
SQL

echo "Deleting offers by sellerId (should be fast without RESTRICT FKs)"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"DELETE FROM \"Inventory\" i USING \"SellerOffer\" o, \"Seller\" s WHERE i.\"offerId\"=o.id AND o.\"sellerId\"=s.id AND (s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'));"

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"DELETE FROM \"OfferPrice\" p USING \"SellerOffer\" o, \"Seller\" s WHERE p.\"offerId\"=o.id AND o.\"sellerId\"=s.id AND (s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'));"

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"DELETE FROM \"CartItem\" c USING \"SellerOffer\" o, \"Seller\" s WHERE c.\"sellerOfferId\"=o.id AND o.\"sellerId\"=s.id AND (s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'));"

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"DELETE FROM \"OrderItem\" oi USING \"SellerOffer\" o, \"Seller\" s WHERE oi.\"sellerOfferId\"=o.id AND o.\"sellerId\"=s.id AND (s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'));"

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"DELETE FROM \"SalvageUnit\" su USING \"SellerOffer\" o, \"Seller\" s WHERE su.\"sellerOfferId\"=o.id AND o.\"sellerId\"=s.id AND (s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'));"

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"UPDATE \"SellerUploadRow\" r SET \"sellerOfferId\"=NULL FROM \"SellerOffer\" o, \"Seller\" s WHERE r.\"sellerOfferId\"=o.id AND o.\"sellerId\"=s.id AND (s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'));"

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"UPDATE \"SourceRecord\" sr SET \"sellerOfferId\"=NULL FROM \"SellerOffer\" o, \"Seller\" s WHERE sr.\"sellerOfferId\"=o.id AND o.\"sellerId\"=s.id AND (s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'));"

echo "CREATE target_parts + DELETE offers"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
CREATE TABLE IF NOT EXISTS tmp_wipe_parts AS
SELECT DISTINCT o."canonicalPartId" AS id
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
WHERE o."canonicalPartId" IS NOT NULL
  AND (
    s.name ILIKE '%Blackline%'
    OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts')
    OR s."storeId" IN (
      'd16199c4-55b5-429e-ad27-892bed94e00d',
      '3b84b063-3811-481f-a61d-f7846a03558f',
      'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
    )
  );
SELECT COUNT(*) AS parts_marked FROM tmp_wipe_parts;

DELETE FROM "SellerOffer" o
USING "Seller" s
WHERE o."sellerId" = s.id
  AND (
    s.name ILIKE '%Blackline%'
    OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts')
    OR s."storeId" IN (
      'd16199c4-55b5-429e-ad27-892bed94e00d',
      '3b84b063-3811-481f-a61d-f7846a03558f',
      'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
    )
  );
SQL

echo "Recreate FKs"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
ALTER TABLE "Inventory" DROP CONSTRAINT IF EXISTS "Inventory_offerId_fkey";
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_sellerOfferId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_sellerOfferId_fkey";
ALTER TABLE "SalvageUnit" DROP CONSTRAINT IF EXISTS "SalvageUnit_sellerOfferId_fkey";
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SalvageUnit" ADD CONSTRAINT "SalvageUnit_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
SQL

echo "Staging + orphan parts"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
DELETE FROM "RawStagingListing"
WHERE "storeId" IN (
  'd16199c4-55b5-429e-ad27-892bed94e00d',
  '3b84b063-3811-481f-a61d-f7846a03558f',
  'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
);

DELETE FROM tmp_wipe_parts p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = p.id)
   OR EXISTS (SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId" = p.id);

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
SQL

echo VERIFY
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.name, COUNT(o.id) AS offers_left FROM \"Seller\" s LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\"=s.id WHERE s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0') GROUP BY s.name ORDER BY s.name;"

docker start partsbazar360-api-1
sleep 8
docker ps --filter name=partsbazar360-api --format '{{.Names}} {{.Status}}'
echo DONE
