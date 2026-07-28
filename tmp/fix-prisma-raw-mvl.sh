#!/bin/sh
set -eu
cp /tmp/enrich-febest-from-website.mjs /home/ubuntu/PartsBazar360/apps/api/scripts/
cp /tmp/backfill-compat-from-mvl.mjs /home/ubuntu/PartsBazar360/apps/api/scripts/
docker cp /tmp/enrich-febest-from-website.mjs partsbazar360-api-1:/app/scripts/enrich-febest-from-website.mjs
docker cp /tmp/backfill-compat-from-mvl.mjs partsbazar360-api-1:/app/scripts/backfill-compat-from-mvl.mjs

# Kill FEBEST enrich using broken prisma.market filter
PIDS=$(docker exec partsbazar360-api-1 sh -lc "ps aux | grep enrich-febest-from-website | grep -v grep | awk '{print \$1}'" || true)
for p in $PIDS; do docker exec partsbazar360-api-1 sh -lc "kill $p" || true; done
# Kill failed backfill if still around
BP=$(docker exec partsbazar360-api-1 sh -lc "ps aux | grep backfill-compat-from-mvl | grep -v grep | awk '{print \$1}'" || true)
for p in $BP; do docker exec partsbazar360-api-1 sh -lc "kill $p" || true; done
sleep 2

docker exec -d partsbazar360-api-1 sh -lc 'FEBEST_SELLER_ID=seller-superior-auto-parts FEBEST_DELAY_MS=250 FEBEST_CONCURRENCY=2 FEBEST_STATE_PATH=/tmp/febest-enrich-superior-progress.json npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
docker exec -d partsbazar360-api-1 sh -lc 'BACKFILL_ONLY_MISSING=1 npm run backfill:compat-mvl > /tmp/backfill-compat-mvl.log 2>&1'
sleep 12

docker exec partsbazar360-api-1 sh -lc 'echo FEBEST; tail -n 12 /tmp/febest-enrich-mvl.log; echo BACKFILL; tail -n 12 /tmp/backfill-compat-mvl.log'
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c 'SELECT market, COUNT(*) FROM "MvlVehicle" GROUP BY 1 ORDER BY 1;'
echo FIXED
