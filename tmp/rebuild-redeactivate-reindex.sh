#!/bin/bash
set -e
cd /home/ubuntu/PartsBazar360
sudo docker compose build api 2>&1 | tail -6
sudo docker compose up -d api 2>&1 | tail -4
sleep 8
echo "HEALTH=$(curl -sf https://partsbazar360.realtrackapp.com/api/health)"
echo "REDEACTIVATE_START"
sudo docker compose exec -T api node scripts/deactivate-nonenglish-offers.mjs
echo "REINDEX_START"
sudo docker compose exec -T api node scripts/reindex-active-from-db.mjs 2>&1 | tail -6
echo "ALL_DONE"
