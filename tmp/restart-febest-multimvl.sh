#!/bin/sh
set -eu

# Restart FEBEST so it loads the multi-market matcher from disk
PIDS=$(docker exec partsbazar360-api-1 sh -lc "ps aux | grep enrich-febest-from-website | grep -v grep | awk '{print \$1}'" || true)
for p in $PIDS; do
  docker exec partsbazar360-api-1 sh -lc "kill $p" || true
done
sleep 2
docker cp /home/ubuntu/PartsBazar360/apps/api/scripts/enrich-febest-from-website.mjs partsbazar360-api-1:/app/scripts/enrich-febest-from-website.mjs
docker exec -d partsbazar360-api-1 sh -lc 'FEBEST_SELLER_ID=seller-superior-auto-parts FEBEST_DELAY_MS=250 FEBEST_CONCURRENCY=2 FEBEST_STATE_PATH=/tmp/febest-enrich-superior-progress.json npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
sleep 8

docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT market, COUNT(*) FROM "MvlVehicle" WHERE "normalizedMake"='VOLKSWAGEN' AND "normalizedModel"='GOLF' AND year=2015 GROUP BY 1;
SELECT COUNT(*) AS verified_fitments FROM "Fitment" WHERE "verificationStatus"='VERIFIED';
SELECT COUNT(*) AS active_mvl FROM "CanonicalPart" p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id AND o.status='ACTIVE')
  AND 'MVL_VERIFIED' = ANY("fitmentFlags");
SQL

echo ----BACKFILL----
docker exec partsbazar360-api-1 sh -lc 'tail -n 25 /tmp/backfill-compat-mvl.log || true'
echo ----FEBEST----
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep enrich-febest | grep -v grep || true; tail -n 15 /tmp/febest-enrich-mvl.log'
echo ----SALVAGEA----
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep seed-salvagea | grep -v grep || true'
