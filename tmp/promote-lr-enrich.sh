#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
PART=42d68327-e54d-4ecf-889f-6153717e7c6f

echo "=== reset + promote ==="
sudo docker compose exec -T redis redis-cli DEL "bull:enrichment:enrich:${PART}:v2" >/dev/null || true
sudo docker compose exec -T redis redis-cli ZREM bull:enrichment:prioritized "enrich:${PART}:v2" >/dev/null || true

sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -v ON_ERROR_STOP=1 <<SQL
UPDATE "CanonicalPart"
SET "enrichmentStatus" = 'NONE',
    "enrichmentVersion" = 0
WHERE id = '$PART';
SELECT id, "enrichmentStatus", "enrichmentVersion" FROM "CanonicalPart" WHERE id = '$PART';
SQL

echo "=== trigger PDP enrich (priority 5) ==="
curl -sL -o /tmp/pdp.json -w "pdp_http=%{http_code}\n" "https://partsbazar360.com/api/search/parts/$PART"
python3 -c "import json;d=json.load(open('/tmp/pdp.json'));print('status',d.get('enrichmentStatus'),'price', (d.get('offers') or [{}])[0].get('price'))"

sleep 3
echo "=== enrichment snapshot ==="
curl -sL "https://partsbazar360.com/api/search/parts/$PART/enrichment" | python3 -m json.tool

echo "=== queue ==="
echo wait=$(sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:wait)
echo active=$(sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:active)
echo prioritized=$(sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized)
sudo docker compose exec -T redis redis-cli HGETALL "bull:enrichment:enrich:${PART}:v2" | head -40

echo "=== poll up to ~3 min ==="
for i in $(seq 1 36); do
  sleep 5
  curl -sL "https://partsbazar360.com/api/search/parts/$PART/enrichment" -o /tmp/enr.json
  python3 - <<'PY'
import json
d=json.load(open('/tmp/enr.json'))
print(f"poll status={d.get('enrichmentStatus')} ver={d.get('enrichmentVersion')} specs={d.get('hasItemSpecifics')} info={bool(d.get('infographicUrl'))} diagram={bool(d.get('locationDiagramUrl'))} ship={ (d.get('shipping') or {}).get('state')}")
open('/tmp/done.flag','w').write('1' if d.get('enrichmentStatus') in ('DONE','FAILED','DEFERRED') else '0')
PY
  if [ "$(cat /tmp/done.flag)" = "1" ]; then break; fi
done

echo "=== final ==="
curl -sL "https://partsbazar360.com/api/search/parts/$PART/enrichment" | python3 -m json.tool
sudo docker compose logs --since 5m worker 2>/dev/null | grep -iE "$PART|EnrichmentProcessor|ItemSpecific|LocationDiagram|Infographic|failed for" | tail -30
