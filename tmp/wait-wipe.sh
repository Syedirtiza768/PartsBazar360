#!/bin/bash
set -eu
while ps aux | grep -q '[r]un-wipe-indexed'; do
  sleep 20
  echo waiting
  docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -f /tmp/pg-activity.sql | head -n 20 || true
done
echo FINISHED
tail -n 50 /tmp/wipe-indexed.log
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
"SELECT s.name, COUNT(o.id) AS offers FROM \"Seller\" s LEFT JOIN \"SellerOffer\" o ON o.\"sellerId\"=s.id WHERE s.id IN ('seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0') GROUP BY s.name;"
