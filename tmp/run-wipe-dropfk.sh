#!/bin/bash
set -eu

echo "Terminate stuck wipe"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='partsbazar_db' AND pid <> pg_backend_pid() AND query ILIKE '%DELETE FROM%SellerOffer%';" || true
pkill -f run-wipe-fast.sh || true
sleep 3

echo "Running drop-FK wipe"
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

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

CREATE TEMP TABLE target_parts AS
SELECT DISTINCT o."canonicalPartId" AS id
FROM "SellerOffer" o
JOIN target_sellers s ON s.id = o."sellerId"
WHERE o."canonicalPartId" IS NOT NULL;

SELECT 'before_offers' AS k, COUNT(*)::bigint AS n
FROM "SellerOffer" o JOIN target_sellers s ON s.id = o."sellerId";

DELETE FROM "CartItem" c USING "SellerOffer" o, target_sellers s
WHERE c."sellerOfferId" = o.id AND o."sellerId" = s.id;
DELETE FROM "OrderItem" oi USING "SellerOffer" o, target_sellers s
WHERE oi."sellerOfferId" = o.id AND o."sellerId" = s.id;
DELETE FROM "SalvageUnit" su USING "SellerOffer" o, target_sellers s
WHERE su."sellerOfferId" = o.id AND o."sellerId" = s.id;
DELETE FROM "Inventory" i USING "SellerOffer" o, target_sellers s
WHERE i."offerId" = o.id AND o."sellerId" = s.id;
DELETE FROM "OfferPrice" p USING "SellerOffer" o, target_sellers s
WHERE p."offerId" = o.id AND o."sellerId" = s.id;

UPDATE "SellerUploadRow" r SET "sellerOfferId" = NULL
FROM "SellerOffer" o, target_sellers s
WHERE r."sellerOfferId" = o.id AND o."sellerId" = s.id;
UPDATE "SourceRecord" sr SET "sellerOfferId" = NULL
FROM "SellerOffer" o, target_sellers s
WHERE sr."sellerOfferId" = o.id AND o."sellerId" = s.id;
UPDATE "SupportTicket" t SET "sellerOfferId" = NULL
FROM "SellerOffer" o, target_sellers s
WHERE t."sellerOfferId" = o.id AND o."sellerId" = s.id;

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

DELETE FROM "SellerOffer" o USING target_sellers s WHERE o."sellerId" = s.id;

ALTER TABLE "Inventory"
  ADD CONSTRAINT "Inventory_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_sellerOfferId_fkey"
  FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_sellerOfferId_fkey"
  FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SalvageUnit"
  ADD CONSTRAINT "SalvageUnit_sellerOfferId_fkey"
  FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

DELETE FROM "RawStagingListing"
WHERE "storeId" IN (SELECT "storeId" FROM target_sellers WHERE "storeId" IS NOT NULL);

CREATE TEMP TABLE orphan_parts AS
SELECT p.id FROM target_parts p
WHERE NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId" = p.id);

SELECT 'orphan_parts' AS k, COUNT(*)::bigint AS n FROM orphan_parts;

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

COMMIT;
SQL

echo VERIFY
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.name, COUNT(o.id) AS offers_left FROM \"Seller\" s LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\"=s.id WHERE s.name ILIKE '%Blackline%' OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts') OR s.\"storeId\" IN ('d16199c4-55b5-429e-ad27-892bed94e00d','3b84b063-3811-481f-a61d-f7846a03558f','eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0') GROUP BY s.name ORDER BY s.name;"

echo DONE
