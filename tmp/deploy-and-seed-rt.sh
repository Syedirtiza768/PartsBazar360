#!/bin/bash
# Deploy ingestion enrichment + start Salvage/Blackline RealTrack seed.
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== Copy updated ingestion sources into repo ==="
sudo cp /tmp/listing-enrichment.util.ts apps/api/src/modules/ingestion/listing-enrichment.util.ts
sudo cp /tmp/listing-enrichment.util.spec.ts apps/api/src/modules/ingestion/listing-enrichment.util.spec.ts
sudo cp /tmp/ingestion.processor.ts apps/api/src/modules/ingestion/ingestion.processor.ts

echo "=== Rebuild API ==="
sudo docker compose up -d --build api

echo "=== Wait for API healthy ==="
for i in $(seq 1 90); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
  echo "health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ] && [ "$i" -gt 15 ]; then
    sudo docker compose logs --tail=80 api
    exit 1
  fi
  sleep 5
done

CID=$(sudo docker compose ps -q api)

echo "=== Marketplace seller / warehouse check ==="
sudo docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
  "SELECT id, name, \"storeId\" FROM \"Seller\" WHERE \"storeId\" IN ('3b84b063-3811-481f-a61d-f7846a03558f','d16199c4-55b5-429e-ad27-892bed94e00d') OR id IN ('seller-salvage-auto-parts','seller-blackline-auto-parts') ORDER BY name;"

# Ensure warehouses exist for those sellers
sudo docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c \
  "INSERT INTO \"Warehouse\" (id, \"sellerId\", name, \"createdAt\", \"updatedAt\")
   SELECT gen_random_uuid()::text, s.id, s.name || ' Main Warehouse', NOW(), NOW()
   FROM \"Seller\" s
   WHERE s.\"storeId\" IN ('3b84b063-3811-481f-a61d-f7846a03558f','d16199c4-55b5-429e-ad27-892bed94e00d')
     AND NOT EXISTS (SELECT 1 FROM \"Warehouse\" w WHERE w.\"sellerId\" = s.id);"

echo "=== Stop any prior seed ==="
sudo docker exec "$CID" sh -c 'pkill -f seed-realtrack-dynatrade || true; pkill -f seed-marketplace || true' || true

echo "=== Start seed:realtrack-dynatrade (Salvage + Blackline only) ==="
sudo docker exec -d "$CID" sh -c '
  cd /app &&
  SEED_INCLUDE_DYNATRADE=0 \
  SEED_ALL_REALTRACK_STORES=false \
  SEED_REPORT_PATH=/tmp/seed-realtrack-report.json \
  npm run seed:realtrack-dynatrade > /tmp/seed-realtrack.log 2>&1
'

sleep 10
echo "=== Process check ==="
sudo docker exec "$CID" sh -c 'ps aux | grep -E "seed-realtrack|seed-realtrack-dynatrade" | grep -v grep || echo NOT_RUNNING'
echo "=== Log tail ==="
sudo docker exec "$CID" sh -c 'wc -l /tmp/seed-realtrack.log 2>/dev/null; tail -n 50 /tmp/seed-realtrack.log 2>/dev/null || echo no_log_yet'
echo "Monitor: sudo docker exec $CID tail -f /tmp/seed-realtrack.log"
