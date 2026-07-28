#!/bin/bash
set -e
cd /home/ubuntu/PartsBazar360
sudo docker cp /tmp/deactivate-nonenglish-offers.mjs partsbazar360-api-1:/app/scripts/deactivate-nonenglish-offers.mjs
echo "DEACTIVATE_START"
sudo docker compose exec -T api node scripts/deactivate-nonenglish-offers.mjs
echo "REINDEX_START"
sudo docker compose exec -T api node scripts/reindex-active-from-db.mjs 2>&1 | tail -6
echo "ALL_DONE"
