#!/bin/bash
set -euo pipefail
sudo docker exec partsbazar360-api-1 node -e '
fetch("http://localhost:3001/search/parts?limit=1")
  .then((r) => r.json())
  .then((j) => console.log(JSON.stringify({ total: j.total, page: j.page, items: (j.items || []).length })))
  .catch((e) => { console.error(e); process.exit(1); });
'
echo "ingestion wait:" $(sudo docker exec partsbazar360-redis-1 redis-cli LLEN bull:ingestion:wait)
echo "ingestion active:" $(sudo docker exec partsbazar360-redis-1 redis-cli LLEN bull:ingestion:active)
echo "OS count:" $(sudo docker exec partsbazar360-opensearch-1 curl -s http://localhost:9200/canonical_parts/_count)
