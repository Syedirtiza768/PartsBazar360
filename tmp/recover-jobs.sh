#!/bin/sh
set -eu
cp /tmp/enrich-febest-from-website.mjs /home/ubuntu/PartsBazar360/apps/api/scripts/
# wait for api healthy
for i in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec partsbazar360-api-1 true 2>/dev/null; then
    break
  fi
  sleep 3
done
docker cp /tmp/enrich-febest-from-website.mjs partsbazar360-api-1:/app/scripts/enrich-febest-from-website.mjs
docker cp /tmp/backfill-compat-from-mvl.mjs partsbazar360-api-1:/app/scripts/backfill-compat-from-mvl.mjs 2>/dev/null || true

# restart FEBEST only (SalvageA may have died with container restart)
docker exec -d partsbazar360-api-1 sh -lc 'FEBEST_SELLER_ID=seller-superior-auto-parts FEBEST_DELAY_MS=250 FEBEST_CONCURRENCY=2 FEBEST_STATE_PATH=/tmp/febest-enrich-superior-progress.json npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
docker exec -d partsbazar360-api-1 sh -lc 'BACKFILL_ONLY_MISSING=1 npm run backfill:compat-mvl > /tmp/backfill-compat-mvl.log 2>&1'

# Resume SalvageA if not running
if ! docker exec partsbazar360-api-1 sh -lc 'ps aux | grep seed-salvagea.cli | grep -v grep' >/dev/null 2>&1; then
  docker exec -d partsbazar360-api-1 sh -lc 'SEED_REPORT_PATH=/tmp/seed-salvagea-report.json npm run seed:salvagea > /tmp/seed-salvagea.log 2>&1'
  echo SALVAGEA_RESUMED
fi

sleep 10
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep -E "seed-salvagea|enrich-febest|backfill-compat" | grep -v grep || true'
docker exec partsbazar360-api-1 sh -lc 'tail -n 10 /tmp/febest-enrich-mvl.log; echo ---; tail -n 8 /tmp/backfill-compat-mvl.log'
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c 'SELECT market, COUNT(*) FROM "MvlVehicle" GROUP BY 1 ORDER BY 1;'
echo OK
