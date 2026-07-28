#!/bin/bash
set -eu
REPO=/home/ubuntu/PartsBazar360

echo "==== Sync source files ===="
# Files already uploaded to /tmp by scp from local

cp /tmp/enrich-febest-from-website.mjs "$REPO/apps/api/scripts/enrich-febest-from-website.mjs"
cp /tmp/buyer-visible-offers.util.ts "$REPO/apps/api/src/modules/search/buyer-visible-offers.util.ts"
cp /tmp/buyer-visible-offers.util.spec.ts "$REPO/apps/api/src/modules/search/buyer-visible-offers.util.spec.ts"
cp /tmp/search.controller.ts "$REPO/apps/api/src/modules/search/search.controller.ts"
cp /tmp/opensearch.service.ts "$REPO/apps/api/src/modules/search/opensearch.service.ts"
cp /tmp/format.ts "$REPO/apps/buyer-marketplace/lib/format.ts"
cp /tmp/ProductCard.tsx "$REPO/apps/buyer-marketplace/components/ProductCard.tsx"
cp /tmp/BuyBox.tsx "$REPO/apps/buyer-marketplace/components/BuyBox.tsx"
cp /tmp/reindex-active-from-db.mjs "$REPO/apps/api/scripts/reindex-active-from-db.mjs"

# Hot-fix enrich script into running API container + restart enrich on Superior only
docker cp "$REPO/apps/api/scripts/enrich-febest-from-website.mjs" partsbazar360-api-1:/app/scripts/enrich-febest-from-website.mjs
docker cp "$REPO/apps/api/scripts/reindex-active-from-db.mjs" partsbazar360-api-1:/app/scripts/reindex-active-from-db.mjs

echo "==== Stop FEBEST enrich (will restart after reindex) ===="
PIDS=$(docker exec partsbazar360-api-1 sh -lc "ps aux | grep enrich-febest-from-website | grep -v grep | awk '{print \$1}'" || true)
for p in $PIDS; do
  docker exec partsbazar360-api-1 sh -lc "kill $p" || true
done
sleep 2

echo "==== Wipe + reindex ACTIVE offers only ===="
docker exec partsbazar360-api-1 sh -lc 'cd /app && node scripts/reindex-active-from-db.mjs' 2>&1 | tee /tmp/reindex-active.log
tail -n 15 /tmp/reindex-active.log

echo "==== Seller names in OpenSearch after reindex ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":0,\"aggs\":{\"sellers\":{\"terms\":{\"field\":\"offers.sellerName.keyword\",\"size\":10}}}}"'

echo "==== Rebuild API + buyer marketplace ===="
cd "$REPO"
docker compose build api buyer-marketplace
docker compose up -d api buyer-marketplace

echo "==== Restart FEBEST enrich against Superior ===="
sleep 8
docker exec -d partsbazar360-api-1 sh -lc 'FEBEST_SELLER_ID=seller-superior-auto-parts FEBEST_DELAY_MS=250 FEBEST_CONCURRENCY=2 FEBEST_STATE_PATH=/tmp/febest-enrich-superior-progress.json npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
sleep 6
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep enrich-febest | grep -v grep || true; tail -n 8 /tmp/febest-enrich-mvl.log'

echo "==== Verify sellers again ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":0,\"aggs\":{\"sellers\":{\"terms\":{\"field\":\"offers.sellerName.keyword\",\"size\":10}}}}"'

echo DONE
