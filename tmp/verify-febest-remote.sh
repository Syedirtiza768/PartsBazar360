#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
CID=$(sudo docker compose ps -q api)
sudo docker cp /home/ubuntu/verify-febest-enrich.mjs "$CID":/app/scripts/verify-febest-enrich.mjs
sudo docker exec -w /app "$CID" node /app/scripts/verify-febest-enrich.mjs
echo '---LOG---'
tail -n 6 /home/ubuntu/febest-enrich.log
echo '---'
ps aux | grep 'enrich-febest-from-website' | grep -v grep | head -3 || echo stopped
