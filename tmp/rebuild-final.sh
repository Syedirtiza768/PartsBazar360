#!/bin/bash
set -eu
REPO=/home/ubuntu/PartsBazar360
cp /tmp/format.ts "$REPO/apps/buyer-marketplace/lib/format.ts"
cd "$REPO"
docker compose build api buyer-marketplace
docker compose up -d api buyer-marketplace
sleep 10
docker exec -d partsbazar360-api-1 sh -lc 'FEBEST_SELLER_ID=seller-superior-auto-parts FEBEST_DELAY_MS=250 FEBEST_CONCURRENCY=2 FEBEST_STATE_PATH=/tmp/febest-enrich-superior-progress.json npm run enrich:febest > /tmp/febest-enrich-mvl.log 2>&1'
sleep 5
echo "==== sellers ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":0,\"aggs\":{\"sellers\":{\"terms\":{\"field\":\"offers.sellerName.keyword\",\"size\":10}}}}"'
echo
echo "==== sample FEBEST API ===="
docker exec partsbazar360-api-1 sh -lc 'wget -qO- "http://127.0.0.1:3000/search/parts?brand=FEBEST&limit=1" 2>/dev/null | head -c 1200 || curl -s "http://127.0.0.1:3000/api/search/parts?brand=FEBEST&limit=1" | head -c 1200 || true'
echo
docker compose ps api buyer-marketplace
echo DONE
