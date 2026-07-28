#!/bin/bash
set -eu

echo "=== seed check ==="
docker exec partsbazar360-api-1 sh -c 'ps aux | grep -E "[s]eed" || echo no_seed'

echo "=== BEFORE ==="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.name, o.status, COUNT(*) AS offers
 FROM \"Seller\" s
 JOIN \"SellerOffer\" o ON o.\"sellerId\" = s.id
 WHERE s.name ILIKE '%Blackline%'
    OR s.name IN ('Salvage Auto Parts', 'K. Salvage Auto Parts')
    OR s.id IN ('seller-salvage-auto-parts', 'seller-blackline-auto-parts')
    OR s.\"storeId\" IN (
      'd16199c4-55b5-429e-ad27-892bed94e00d',
      '3b84b063-3811-481f-a61d-f7846a03558f',
      'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
    )
 GROUP BY s.name, o.status
 ORDER BY s.name, o.status;"

# Stop seed without killing the shell via set -e on pkill
docker exec partsbazar360-api-1 sh -c 'pkill -f seed-realtrack; true'
docker exec partsbazar360-api-1 sh -c 'pkill -f seed-marketplace; true'
sleep 2
echo "=== seed after stop ==="
docker exec partsbazar360-api-1 sh -c 'ps aux | grep -E "[s]eed" || echo no_seed'

docker cp /tmp/wipe-blackline-salvage.sql partsbazar360-postgres-1:/tmp/wipe-blackline-salvage.sql
echo "=== WIPING ==="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 -f /tmp/wipe-blackline-salvage.sql

echo "=== AFTER ==="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.name, COUNT(o.id) AS offers_left
 FROM \"Seller\" s
 LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\" = s.id
 WHERE s.name ILIKE '%Blackline%'
    OR s.name IN ('Salvage Auto Parts', 'K. Salvage Auto Parts')
    OR s.id IN ('seller-salvage-auto-parts', 'seller-blackline-auto-parts')
    OR s.\"storeId\" IN (
      'd16199c4-55b5-429e-ad27-892bed94e00d',
      '3b84b063-3811-481f-a61d-f7846a03558f',
      'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
    )
 GROUP BY s.name
 ORDER BY s.name;"

docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT COUNT(*) AS staging_left FROM \"RawStagingListing\"
 WHERE \"storeId\" IN (
   'd16199c4-55b5-429e-ad27-892bed94e00d',
   '3b84b063-3811-481f-a61d-f7846a03558f',
   'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
 );"

echo DONE
