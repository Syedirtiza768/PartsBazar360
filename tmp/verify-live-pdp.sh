#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
CID=$(sudo docker compose ps -q api)
ID=688a2214-115f-4ce1-a26c-797be4aa6927
sudo docker exec "$CID" wget -qO- "http://127.0.0.1:3001/search/parts/$ID" > /tmp/febest-live-part.json
sudo docker cp /tmp/febest-live-part.json "$CID":/tmp/febest-live-part.json
# host file is already at /tmp; parse with python3
python3 - <<'PY'
import json
j=json.load(open('/tmp/febest-live-part.json'))
print(json.dumps({
  'mpn': j.get('manufacturerPartNumber'),
  'enrichmentLive': j.get('enrichmentLive'),
  'enrichmentSource': j.get('enrichmentSource'),
  'listingUrl': j.get('listingUrl'),
  'images': (j.get('imageUrls') or [])[:2],
  'compatRows': len(j.get('compatibilityTable') or j.get('compatibility') or []),
  'sample': (j.get('compatibilityTable') or j.get('compatibility') or [])[:2],
}, indent=2))
PY
# also via public URL
curl -sS "https://partsbazar360.realtrackapp.com/api/search/parts/$ID" | python3 - <<'PY'
import json,sys
j=json.load(sys.stdin)
print('PUBLIC', json.dumps({
  'enrichmentLive': j.get('enrichmentLive'),
  'enrichmentSource': j.get('enrichmentSource'),
  'images': len(j.get('imageUrls') or []),
  'compatRows': len(j.get('compatibilityTable') or j.get('compatibility') or []),
}, indent=2))
PY
