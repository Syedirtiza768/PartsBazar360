#!/bin/bash
# Run initial marketplace seed inside the API container.
# Usage: bash /home/ubuntu/run-marketplace-seed.sh
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "Rebuilding API with latest seed/auth/isolation code..."
sudo docker compose up -d --build api

echo "Waiting for API health..."
for i in $(seq 1 60); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
  echo "health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ] && [ "$i" -gt 10 ]; then
    sudo docker compose logs --tail=50 api
    exit 1
  fi
  sleep 5
done

CID=$(sudo docker compose ps -q api)

# Mount seed files into a one-shot seed run via docker cp
sudo docker cp /home/ubuntu/seed-data/. "$CID":/seed-data/

echo "Starting marketplace seed (SalvageA + blacklineusedautoparts + Superior spreadsheets)..."
echo "Full RealTrack catalogs are large (~25k+25k); this will run in background."

sudo docker exec -d "$CID" sh -c '
  mkdir -p /seed-data
  SEED_EBAY_STORES=true \
  SEED_SPREADSHEET_SELLERS=true \
  SEED_AUTH_USERS=true \
  SEED_ALL_REALTRACK_STORES=false \
  SEED_FEBEST_FILE=/seed-data/FEBEST_Availability.xlsx \
  SEED_DXB_FILE=/seed-data/DXB-EXW.xlsx \
  SEED_DYNATRADE_FILE=/seed-data/Dynatrade-STOCK.xlsx \
  SEED_FEBEST_CURRENCY=AED \
  SEED_DYNATRADE_CURRENCY=AED \
  SEED_REPORT_PATH=/tmp/seed-report.json \
  npm run seed:marketplace > /tmp/seed-marketplace.log 2>&1
'

echo "Seed started. Monitor with:"
echo "  sudo docker exec $CID tail -f /tmp/seed-marketplace.log"
echo "  sudo docker exec $CID cat /tmp/seed-report.json"
