#!/bin/bash
# Configure worker for SVG-only batch (no location diagrams), raise AI budget,
# bump concurrency, enqueue candidates, then monitor progress.
set -euo pipefail
cd /home/ubuntu/PartsBazar360
ENVF=/home/ubuntu/PartsBazar360/.env

upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENVF"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENVF"
  else
    echo "${key}=${val}" >> "$ENVF"
  fi
}

echo "=== configuring worker for SVG batch ==="
upsert_env LOCATION_DIAGRAM_MIN_PRICE_USD 999999
upsert_env ENRICHMENT_DAILY_BUDGET_USD 25
upsert_env ENRICHMENT_CONCURRENCY 4
upsert_env ENRICHMENT_PREWARM 0
grep -E 'LOCATION_DIAGRAM_MIN|ENRICHMENT_DAILY|ENRICHMENT_CONCURRENCY|ENRICHMENT_PREWARM' "$ENVF"

echo "=== restart worker ==="
sudo docker compose up -d --force-recreate worker
sleep 8
sudo docker compose exec -T worker sh -c 'echo DIAG_MIN=$LOCATION_DIAGRAM_MIN_PRICE_USD BUDGET=$ENRICHMENT_DAILY_BUDGET_USD CONC=$ENRICHMENT_CONCURRENCY'

echo "=== copy enqueue script ==="
CID=$(sudo docker compose ps -q api)
sudo docker cp /tmp/enqueue-svg-batch.cjs "$CID":/app/enqueue-svg-batch.cjs

echo "=== enqueue ==="
# Prefer api container (has bullmq + pg). Pass DB password from compose env.
sudo docker compose exec -T \
  -e SVG_BATCH_PRIORITY=20 \
  -e SVG_BATCH_STATE=/tmp/svg-batch-state.json \
  -e POSTGRES_HOST=postgres \
  -e POSTGRES_USER=partsbazar_user \
  -e POSTGRES_PASSWORD=partsbazar_password \
  -e POSTGRES_DB=partsbazar_db \
  -e REDIS_HOST=redis \
  api node /app/enqueue-svg-batch.cjs

sudo docker compose cp api:/tmp/svg-batch-state.json /tmp/svg-batch-state.json || true
echo "=== queue depths after enqueue ==="
sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:wait
sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized
sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:active
