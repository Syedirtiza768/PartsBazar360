#!/bin/bash
set -eu
echo "==== Superior FEBEST sample ===="
docker exec partsbazar360-api-1 sh -lc 'wget -qO- "http://127.0.0.1:3001/search/parts?q=CHAB-AVB&limit=2"' | head -c 2000
echo
echo "==== seller buckets ===="
docker exec partsbazar360-api-1 sh -lc 'curl -s "http://opensearch:9200/canonical_parts/_search" -H "content-type: application/json" -d "{\"size\":0,\"aggs\":{\"sellers\":{\"terms\":{\"field\":\"offers.sellerName.keyword\",\"size\":10}}}}"'
echo
