#!/bin/bash
set -e
cp /tmp/listing-title.util.ts /home/ubuntu/PartsBazar360/apps/api/src/modules/ingestion/listing-title.util.ts
cd /home/ubuntu/PartsBazar360
sudo docker compose build api 2>&1 | tail -4
sudo docker compose up -d api 2>&1 | tail -3
sleep 8
sudo docker cp /tmp/deactivate-nonenglish-offers.mjs partsbazar360-api-1:/app/scripts/deactivate-nonenglish-offers.mjs
echo "DEACTIVATE_START"
sudo docker compose exec -T api node scripts/deactivate-nonenglish-offers.mjs
echo "REINDEX_START"
sudo docker compose exec -T api node scripts/reindex-active-from-db.mjs 2>&1 | tail -4
echo "ALL_DONE"
