#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== pause throttle ==="
sudo pkill -f 'throttle-svg-batch.cjs' 2>/dev/null || true
sleep 2

echo "=== drain enrichment queue to zero ==="
sudo docker compose exec -T redis redis-cli DEL bull:enrichment:delayed bull:enrichment:prioritized bull:enrichment:wait bull:enrichment:active || true

# Leave worker running but idle
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
UPDATE "CanonicalPart"
SET "enrichmentStatus" = 'DEFERRED'
WHERE "enrichmentStatus" IN ('QUEUED', 'RUNNING')
  AND "infographicSpec" IS NULL;
SQL

WAIT=$(sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized | tr -d '\r')
echo "prioritized_now=$WAIT"

# Restart throttle cleanly
CID=$(sudo docker compose ps -q api)
sudo docker cp /tmp/throttle-svg-batch.cjs "$CID":/app/throttle-svg-batch.cjs
LOG=/home/ubuntu/svg-throttle.log
: > "$LOG"

nohup sudo docker compose exec -T \
  -e SVG_WAVE_SIZE=12 \
  -e SVG_WAVE_RESUME_BELOW=0 \
  -e SVG_WAVE_PAUSE_MS=45000 \
  -e SVG_BATCH_PRIORITY=20 \
  -e SVG_BATCH_STATE=/tmp/svg-throttle-state.json \
  -e POSTGRES_HOST=postgres \
  -e POSTGRES_USER=partsbazar_user \
  -e POSTGRES_PASSWORD=partsbazar_password \
  -e POSTGRES_DB=partsbazar_db \
  -e REDIS_HOST=redis \
  api node /app/throttle-svg-batch.cjs \
  > "$LOG" 2>&1 &

echo "throttle_pid=$!"
sleep 10
tail -20 "$LOG"
sudo docker compose logs worker --since 2m 2>&1 | grep -iE 'WARN|ERROR|infographic|RealTrack|429' | tail -20 || true
