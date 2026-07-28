#!/bin/bash
set -euo pipefail
echo "=== Flush Redis ==="
sudo docker exec partsbazar360-redis-1 redis-cli FLUSHALL
echo
echo "=== Restart buyer-marketplace (clear Next.js facet cache) ==="
sudo docker restart partsbazar360-buyer-marketplace-1
sleep 8
sudo docker ps --filter name=buyer-marketplace --format '{{.Names}} {{.Status}}'
echo
echo "=== OpenSearch final count ==="
sudo docker exec partsbazar360-opensearch-1 curl -s 'http://localhost:9200/canonical_parts/_count'
echo
echo "=== Sample search (first 3 titles) ==="
sudo docker exec partsbazar360-opensearch-1 curl -s 'http://localhost:9200/canonical_parts/_search?size=3&_source=title,brand,minPrice' | head -c 1200
echo
