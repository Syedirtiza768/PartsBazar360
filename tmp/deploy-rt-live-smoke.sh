#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

git fetch origin main
git reset --hard origin/main
echo "HEAD=$(git rev-parse --short HEAD)"

sudo docker compose build api worker
sudo docker compose up -d api worker

for i in $(seq 1 30); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
  echo "api_health=$STATUS ($i)"
  [ "$STATUS" = "healthy" ] && break
  sleep 4
done

PART=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT cp.id FROM \"CanonicalPart\" cp
   JOIN \"SellerOffer\" so ON so.\"canonicalPartId\"=cp.id
   WHERE so.status='ACTIVE' AND so.\"externalOfferId\" ~ '^[0-9a-f-]{36}$'
     AND (cp.\"enrichmentStatus\" IS DISTINCT FROM 'DONE' OR cp.\"enrichmentVersion\" < 3 OR cp.\"itemSpecifics\" IS NULL)
   LIMIT 1;")
echo "part=$PART"

sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c \
  "UPDATE \"CanonicalPart\" SET \"enrichmentStatus\"='NONE', \"enrichmentVersion\"=0 WHERE id='$PART';"

# Drop any prior job id so we can requeue at v3
sudo docker compose exec -T redis redis-cli DEL "bull:enrichment:enrich:${PART}:v3" >/dev/null || true

curl -sL -o /dev/null -w "pdp=%{http_code}\n" "https://partsbazar360.com/api/search/parts/$PART"

for i in $(seq 1 24); do
  sleep 3
  curl -sL "https://partsbazar360.com/api/search/parts/$PART/enrichment" -o /tmp/enr.json
  python3 - <<'PY'
import json
d=json.load(open("/tmp/enr.json"))
print(f"poll status={d.get('enrichmentStatus')} ver={d.get('enrichmentVersion')} specs={d.get('hasItemSpecifics')} images_lead={bool(d.get('locationDiagramUrl') or d.get('infographicUrl'))}")
open("/tmp/done.flag","w").write("1" if d.get("enrichmentStatus") in ("DONE","FAILED","DEFERRED") else "0")
PY
  [ "$(cat /tmp/done.flag)" = "1" ] && break
done

echo "=== final enrichment ==="
python3 -m json.tool /tmp/enr.json | head -80

echo "=== db row ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c \
  "SELECT \"enrichmentStatus\", \"enrichmentVersion\", \"enrichmentSource\",
          (\"itemSpecifics\" IS NOT NULL) AS has_specs,
          cardinality(\"imageUrls\") AS images,
          left(COALESCE(\"description\",''), 80) AS desc_prefix
   FROM \"CanonicalPart\" WHERE id='$PART';"

echo "=== worker ==="
sudo docker compose logs --since 3m worker 2>/dev/null | grep -iE "$PART|RealTrack|trading|EnrichmentProcessor|DONE|deferred|failed" | tail -25

echo "buyer: https://partsbazar360.com/buyer/part/$PART/"
