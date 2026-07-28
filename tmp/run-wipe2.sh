#!/bin/bash
set -eu

echo "Killing seed by PID if present"
docker exec partsbazar360-api-1 sh -c 'ps aux' | tee /tmp/api-ps.txt | grep -E 'seed-realtrack|seed-marketplace' | grep -v grep || true
# kill node seed by exact cmdline via kill, not pkill (BusyBox pkill quirks)
docker top partsbazar360-api-1 -eo pid,cmd | tee /tmp/api-top.txt || true

# Use SIGTERM on matching PIDs from docker top
PIDS=$(docker top partsbazar360-api-1 -eo pid,cmd | awk '/seed-realtrack|seed-marketplace/ {print $1}')
echo "SEED_PIDS=$PIDS"
for p in $PIDS; do
  docker exec partsbazar360-api-1 kill "$p" || true
done
sleep 3
docker top partsbazar360-api-1 -eo pid,cmd | grep -E 'seed|node' || true

echo "Running SQL wipe..."
docker cp /tmp/wipe-blackline-salvage.sql partsbazar360-postgres-1:/tmp/wipe-blackline-salvage.sql
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 -f /tmp/wipe-blackline-salvage.sql

echo "AFTER"
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.name, COUNT(o.id) AS offers_left
 FROM \"Seller\" s
 LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\" = s.id
 WHERE s.name ILIKE '%Blackline%'
    OR s.name IN ('Salvage Auto Parts', 'K. Salvage Auto Parts')
    OR s.\"storeId\" IN (
      'd16199c4-55b5-429e-ad27-892bed94e00d',
      '3b84b063-3811-481f-a61d-f7846a03558f',
      'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
    )
 GROUP BY s.name
 ORDER BY s.name;"

echo DONE
