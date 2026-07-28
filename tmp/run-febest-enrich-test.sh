#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
CID=$(sudo docker compose ps -q api)
echo "CID=$CID"
sudo docker exec "$CID" mkdir -p /app/scripts
sudo docker cp /home/ubuntu/enrich-febest-from-website.mjs "$CID":/app/scripts/enrich-febest-from-website.mjs
sudo docker exec \
  -e FEBEST_LIMIT=3 \
  -e FEBEST_CONCURRENCY=1 \
  -e FEBEST_DELAY_MS=500 \
  -e FEBEST_STATE_PATH=/tmp/febest-enrich-progress-test.json \
  "$CID" node /app/scripts/enrich-febest-from-website.mjs
