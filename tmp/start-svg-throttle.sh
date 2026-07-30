#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

# Cool down RealTrack rate limit
echo "cooling down 90s..."
sleep 90

CID=$(sudo docker compose ps -q api)
sudo docker cp /tmp/throttle-svg-batch.cjs "$CID":/app/throttle-svg-batch.cjs

LOG=/home/ubuntu/svg-throttle.log
: > "$LOG"

# Kill prior throttle if any
pkill -f 'throttle-svg-batch.cjs' 2>/dev/null || true

nohup sudo docker compose exec -T \
  -e SVG_WAVE_SIZE=15 \
  -e SVG_WAVE_RESUME_BELOW=1 \
  -e SVG_WAVE_PAUSE_MS=60000 \
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
sleep 5
tail -n 20 "$LOG"
