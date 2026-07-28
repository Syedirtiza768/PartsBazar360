#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
CID=$(sudo docker compose ps -q api)

# Stop previous enricher if still running
PIDS=$(pgrep -f 'enrich-febest-from-website.mjs' || true)
if [ -n "${PIDS:-}" ]; then
  echo "Stopping old enricher PIDs: $PIDS"
  sudo kill $PIDS || true
  sleep 2
fi

sudo docker cp /home/ubuntu/enrich-febest-from-website.mjs "$CID":/app/scripts/enrich-febest-from-website.mjs
# Reset in-container progress; resume is driven by DB image/compat state
sudo docker exec "$CID" rm -f /tmp/febest-enrich-progress.json || true

LOG=/home/ubuntu/febest-enrich.log
: > "$LOG"

nohup sudo docker exec \
  -e FEBEST_CONCURRENCY=4 \
  -e FEBEST_DELAY_MS=200 \
  -e FEBEST_STATE_PATH=/tmp/febest-enrich-progress.json \
  "$CID" node /app/scripts/enrich-febest-from-website.mjs \
  > "$LOG" 2>&1 &

echo "PID=$!"
sleep 3
tail -n 30 "$LOG"
