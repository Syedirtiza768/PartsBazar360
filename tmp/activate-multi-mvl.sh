#!/bin/sh
set -eu

# Hotfix enrich + backfill scripts into running API container
docker cp /home/ubuntu/PartsBazar360/apps/api/scripts/enrich-febest-from-website.mjs partsbazar360-api-1:/app/scripts/enrich-febest-from-website.mjs
cp /tmp/enrich-febest-from-website.mjs /home/ubuntu/PartsBazar360/apps/api/scripts/enrich-febest-from-website.mjs 2>/dev/null || true
docker cp /tmp/enrich-febest-from-website.mjs partsbazar360-api-1:/app/scripts/enrich-febest-from-website.mjs
docker cp /tmp/backfill-compat-from-mvl.mjs partsbazar360-api-1:/app/scripts/backfill-compat-from-mvl.mjs
cp /tmp/backfill-compat-from-mvl.mjs /home/ubuntu/PartsBazar360/apps/api/scripts/ 2>/dev/null || true

# Smoke: MVL market counts + sample EU match
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT market, COUNT(*) FROM "MvlVehicle" GROUP BY 1 ORDER BY 1;
SELECT market, make, model, year, "kType", epid
FROM "MvlVehicle"
WHERE "normalizedMake"='TOYOTA' AND "normalizedModel"='RAV4' AND year=2010
ORDER BY market LIMIT 8;
SELECT market, make, model, year
FROM "MvlVehicle"
WHERE "normalizedMake"='VOLKSWAGEN' AND "normalizedModel"='GOLF' AND year=2015
ORDER BY market LIMIT 8;
SQL

# Re-verify existing compatibility JSON against full multi-market MVL (no rescrape)
docker exec -d partsbazar360-api-1 sh -lc 'BACKFILL_ONLY_MISSING=1 npm run backfill:compat-mvl > /tmp/backfill-compat-mvl.log 2>&1'
sleep 6
docker exec partsbazar360-api-1 sh -lc 'tail -n 30 /tmp/backfill-compat-mvl.log || true'

# Ensure FEBEST enrich is still running with latest script for remaining parts
FEBEST_PID=$(docker exec partsbazar360-api-1 sh -lc "ps aux | grep enrich-febest-from-website | grep -v grep | awk '{print \$1}'" || true)
if [ -n "$FEBEST_PID" ]; then
  echo "FEBEST already running pid=$FEBEST_PID (will pick up new script on next process start; leave running)"
else
  docker exec -d partsbazar360-api-1 sh -lc 'FEBEST_SELLER_ID=seller-superior-auto-parts FEBEST_DELAY_MS=250 FEBEST_CONCURRENCY=2 FEBEST_STATE_PATH=/tmp/febest-enrich-superior-progress.json npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
  echo FEBEST_RESTARTED
fi

echo MULTI_MVL_READY
