#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
git pull --ff-only origin main
echo "HEAD=$(git rev-parse --short HEAD)"
sudo docker compose up -d --build api
for i in $(seq 1 40); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
  echo "health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  sleep 5
done
CID=$(sudo docker compose ps -q api)
sudo docker exec "$CID" wget -qO- 'http://127.0.0.1:3001/search/parts?q=FEBEST&partType=AFTERMARKET&limit=6' > /tmp/febest-search.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/febest-search.json'))
items=j.get('items') or []
print('count', len(items))
for it in items[:6]:
  imgs=it.get('imageUrls') or []
  print(json.dumps({
    'mpn': it.get('manufacturerPartNumber'),
    'brand': it.get('brand'),
    'images': len(imgs),
    'first': imgs[0] if imgs else None,
    'source': it.get('enrichmentSource'),
  }))
PY
