#!/bin/sh
set -eu

# Hotfix FEBEST script (no image rebuild needed for .mjs)
docker cp /home/ubuntu/PartsBazar360/apps/api/scripts/enrich-febest-from-website.mjs partsbazar360-api-1:/app/scripts/enrich-febest-from-website.mjs

# Stop current FEBEST enrich (keep SalvageA running)
PIDS=$(docker exec partsbazar360-api-1 sh -lc "ps aux | grep enrich-febest-from-website | grep -v grep | awk '{print \$1}'" || true)
for p in $PIDS; do
  docker exec partsbazar360-api-1 sh -lc "kill $p" || true
done
sleep 2

# Restart FEBEST enrich against Superior (active marketplace FEBEST offers)
docker exec -d partsbazar360-api-1 sh -lc 'FEBEST_SELLER_ID=seller-superior-auto-parts FEBEST_FORCE=1 FEBEST_DELAY_MS=250 FEBEST_CONCURRENCY=2 FEBEST_STATE_PATH=/tmp/febest-enrich-superior-progress.json npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
sleep 8
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep enrich-febest | grep -v grep || true; tail -n 30 /tmp/febest-enrich-mvl.log'

# Rebuild API so SalvageA path gets the epid fix (rolling)
cd /home/ubuntu/PartsBazar360
# Sync mvl-fitment.service.ts already on host; rebuild is heavy — copy compiled approach:
# For now SalvageA continues with old code; epid bug mainly hits FEBEST multi-trim.
# Quick patch: rebuild only if needed. Skip full rebuild to keep SalvageA alive.
echo FEBEST_RESTARTED
