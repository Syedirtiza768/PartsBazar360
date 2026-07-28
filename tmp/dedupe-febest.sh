#!/bin/bash
set -eu

# Kill duplicate FEBEST enrich processes; keep the oldest one
PIDS=$(docker exec partsbazar360-api-1 sh -lc "ps aux | grep enrich-febest-from-website | grep -v grep | awk '{print \$1}'" || true)
echo "Found PIDs: $PIDS"
COUNT=$(echo "$PIDS" | wc -w)
if [ "$COUNT" -gt 1 ]; then
  KEEP=$(echo "$PIDS" | awk 'NR==1{print}')
  for p in $PIDS; do
    if [ "$p" != "$KEEP" ]; then
      echo "Killing duplicate PID $p"
      docker exec partsbazar360-api-1 sh -lc "kill $p" || true
    fi
  done
  echo "Kept PID $KEEP"
else
  echo "No duplicates"
fi

# Hot-copy updated enrich script (default seller = Superior)
docker cp /tmp/enrich-febest-from-website.mjs partsbazar360-api-1:/app/scripts/enrich-febest-from-website.mjs

sleep 2
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep enrich-febest | grep -v grep || true; tail -n 5 /tmp/febest-enrich-mvl.log'
