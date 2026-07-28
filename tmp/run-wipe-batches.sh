#!/bin/bash
set -eu
docker stop partsbazar360-api-1 >/dev/null 2>&1 || true
pkill -f run-wipe-force || true
sleep 1

# kill any stuck psql inside postgres
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d postgres -c \
"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='partsbazar_db' AND pid<>pg_backend_pid();" || true
sleep 2

# Ensure RESTRICT FKs are gone
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE "Inventory" DROP CONSTRAINT IF EXISTS "Inventory_offerId_fkey";
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_sellerOfferId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_sellerOfferId_fkey";
ALTER TABLE "SalvageUnit" DROP CONSTRAINT IF EXISTS "SalvageUnit_sellerOfferId_fkey";
SQL

echo "Batch deleting offers..."
TOTAL=0
while true; do
  N=$(docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -t -A -c \
    "WITH d AS (
       DELETE FROM \"SellerOffer\" WHERE id IN (
         SELECT id FROM \"SellerOffer\"
         WHERE \"sellerId\" IN (
           'seller-salvage-auto-parts',
           '79aa9032-e0af-4836-bf19-100bd922c7ae',
           '21924d3c-b345-4dcd-900c-b4bcf92b01c0'
         )
         LIMIT 2000
       ) RETURNING 1
     ) SELECT COUNT(*) FROM d;")
  N=$(echo "$N" | tr -d '[:space:]')
  echo "batch=$N total_so_far=$((TOTAL+N))"
  TOTAL=$((TOTAL+N))
  if [ "$N" = "0" ] || [ -z "$N" ]; then
    break
  fi
done

echo "Deleted offers total=$TOTAL"

echo "Cleanup parts/staging/FKs"
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM "RawStagingListing" WHERE "storeId" IN (
  'd16199c4-55b5-429e-ad27-892bed94e00d',
  '3b84b063-3811-481f-a61d-f7846a03558f',
  'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
);

-- recreate FKs
ALTER TABLE "Inventory" DROP CONSTRAINT IF EXISTS "Inventory_offerId_fkey";
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_sellerOfferId_fkey";
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_sellerOfferId_fkey";
ALTER TABLE "SalvageUnit" DROP CONSTRAINT IF EXISTS "SalvageUnit_sellerOfferId_fkey";
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SalvageUnit" ADD CONSTRAINT "SalvageUnit_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- orphan parts from tmp table if present, else skip heavy part delete for now if table missing
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tmp_wipe_parts') THEN
    DELETE FROM tmp_wipe_parts p
    WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id)
       OR EXISTS (SELECT 1 FROM "SellerUploadRow" r WHERE r."canonicalPartId"=p.id);
  END IF;
END $$;
SQL

# If tmp_wipe_parts exists, delete orphans in batches
EXISTS=$(docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tmp_wipe_parts') THEN 1 ELSE 0 END;")
EXISTS=$(echo "$EXISTS" | tr -d '[:space:]')
if [ "$EXISTS" = "1" ]; then
  echo "Deleting orphan canonical parts in batches"
  while true; do
    N=$(docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -t -A <<'SQL'
WITH batch AS (SELECT id FROM tmp_wipe_parts LIMIT 2000),
upd1 AS (UPDATE "SourceRecord" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
upd2 AS (UPDATE "SellerUploadRow" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
upd3 AS (UPDATE "SupportTicket" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
upd4 AS (UPDATE "ReviewTask" SET "canonicalPartId"=NULL WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
fe AS (DELETE FROM "FitmentEvidence" WHERE "fitmentId" IN (SELECT f.id FROM "Fitment" f WHERE f."canonicalPartId" IN (SELECT id FROM batch)) RETURNING 1),
f AS (DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
cpn AS (DELETE FROM "CatalogPartNumber" WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
pm AS (DELETE FROM "ProductMedia" WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
su AS (DELETE FROM "SalvageUnit" WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
rd AS (DELETE FROM "CanonicalPartRedirect" WHERE "fromPartId" IN (SELECT id FROM batch) OR "toPartId" IN (SELECT id FROM batch) RETURNING 1),
ae AS (DELETE FROM "AuditEvent" WHERE "canonicalPartId" IN (SELECT id FROM batch) RETURNING 1),
del AS (DELETE FROM "CanonicalPart" WHERE id IN (SELECT id FROM batch) RETURNING id),
rm AS (DELETE FROM tmp_wipe_parts WHERE id IN (SELECT id FROM del) RETURNING 1)
SELECT COUNT(*) FROM rm;
SQL
)
    N=$(echo "$N" | tr -d '[:space:]')
    echo "parts_batch=$N"
    if [ "$N" = "0" ] || [ -z "$N" ]; then break; fi
  done
  docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c 'DROP TABLE IF EXISTS tmp_wipe_parts;'
fi

echo VERIFY
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.id, s.name, COUNT(o.id) AS offers FROM \"Seller\" s LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\"=s.id WHERE s.id IN ('seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0') GROUP BY s.id, s.name ORDER BY s.name;"

docker start partsbazar360-api-1
sleep 5
docker ps --filter name=partsbazar360-api --format '{{.Names}} {{.Status}}'
echo DONE
