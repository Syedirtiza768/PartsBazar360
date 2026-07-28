#!/bin/bash
set -eu

echo "=== Terminate stuck DELETE backends ==="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='partsbazar_db' AND pid <> pg_backend_pid() AND (query ILIKE '%SellerOffer%' OR query ILIKE '%wipe%');" || true
sleep 2

echo "=== Add FK indexes (non-concurrent, brief locks) ==="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
CREATE INDEX IF NOT EXISTS "Inventory_offerId_idx" ON "Inventory" ("offerId");
CREATE INDEX IF NOT EXISTS "OfferPrice_offerId_idx" ON "OfferPrice" ("offerId");
CREATE INDEX IF NOT EXISTS "CartItem_sellerOfferId_idx" ON "CartItem" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "OrderItem_sellerOfferId_idx" ON "OrderItem" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SalvageUnit_sellerOfferId_idx" ON "SalvageUnit" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SellerUploadRow_sellerOfferId_idx" ON "SellerUploadRow" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SourceRecord_sellerOfferId_idx" ON "SourceRecord" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SupportTicket_sellerOfferId_idx" ON "SupportTicket" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SellerOffer_sellerId_idx" ON "SellerOffer" ("sellerId");
CREATE INDEX IF NOT EXISTS "SellerOffer_canonicalPartId_idx" ON "SellerOffer" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "Fitment_canonicalPartId_idx" ON "Fitment" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "FitmentEvidence_fitmentId_idx" ON "FitmentEvidence" ("fitmentId");
CREATE INDEX IF NOT EXISTS "CatalogPartNumber_canonicalPartId_idx" ON "CatalogPartNumber" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "ProductMedia_canonicalPartId_idx" ON "ProductMedia" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SourceRecord_canonicalPartId_idx" ON "SourceRecord" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SellerUploadRow_canonicalPartId_idx" ON "SellerUploadRow" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "AuditEvent_canonicalPartId_idx" ON "AuditEvent" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "ReviewTask_canonicalPartId_idx" ON "ReviewTask" ("canonicalPartId");
SQL

echo "=== Copy wipe SQL ==="
tr -d '\r' < /tmp/wipe-bs-fast.sql > /tmp/wipe-bs-fast.lf.sql
docker cp /tmp/wipe-bs-fast.lf.sql partsbazar360-postgres-1:/tmp/wipe-bs-fast.sql

echo "=== Run wipe ==="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 -f /tmp/wipe-bs-fast.sql

echo "=== Verify ==="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT s.name, COUNT(o.id) AS offers_left
FROM "Seller" s
LEFT JOIN "SellerOffer" o ON o."sellerId" = s.id
WHERE s.name ILIKE '%Blackline%'
   OR s.name IN ('Salvage Auto Parts', 'K. Salvage Auto Parts')
   OR s."storeId" IN (
     'd16199c4-55b5-429e-ad27-892bed94e00d',
     '3b84b063-3811-481f-a61d-f7846a03558f',
     'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
   )
GROUP BY s.name
ORDER BY s.name;

SELECT COUNT(*) AS staging_left FROM "RawStagingListing"
WHERE "storeId" IN (
  'd16199c4-55b5-429e-ad27-892bed94e00d',
  '3b84b063-3811-481f-a61d-f7846a03558f',
  'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
);
SQL

echo DONE
