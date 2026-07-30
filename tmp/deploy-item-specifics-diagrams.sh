#!/bin/bash
# Deploy item-specifics + location-diagram enrichment (ENRICHMENT_VERSION=2).
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"

echo "=== ensure enrichment env knobs (non-destructive) ==="
ENV_FILE=/home/ubuntu/PartsBazar360/.env
touch "$ENV_FILE"
grep -q '^ENRICHMENT_ENABLED=' "$ENV_FILE" || echo 'ENRICHMENT_ENABLED=1' >> "$ENV_FILE"
grep -q '^LOCATION_DIAGRAM_MIN_PRICE_USD=' "$ENV_FILE" || echo 'LOCATION_DIAGRAM_MIN_PRICE_USD=300' >> "$ENV_FILE"
grep -q '^LOCATION_DIAGRAM_MODEL=' "$ENV_FILE" || echo 'LOCATION_DIAGRAM_MODEL=google/gemini-2.5-flash-image' >> "$ENV_FILE"
grep -q '^ENRICHMENT_MEDIA_DIR=' "$ENV_FILE" || echo 'ENRICHMENT_MEDIA_DIR=/app/data/enrichment' >> "$ENV_FILE"

echo "=== rebuild api + worker + buyer ==="
sudo docker compose build api worker buyer-marketplace
sudo docker compose up -d api worker buyer-marketplace

echo "=== wait for api health ==="
for i in $(seq 1 40); do
  CID=$(sudo docker compose ps -q api)
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$CID" 2>/dev/null || echo starting)
  echo "api_health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ] && [ "$i" -gt 10 ]; then
    sudo docker compose logs --tail=80 api
    exit 1
  fi
  sleep 5
done

echo "=== volume + worker enrichment env ==="
sudo docker compose exec -T api sh -c 'echo ENRICHMENT_MEDIA_DIR=$ENRICHMENT_MEDIA_DIR; ls -la /app/data/enrichment 2>/dev/null || mkdir -p /app/data/enrichment && ls -la /app/data'
sudo docker compose exec -T worker sh -c 'echo ENRICHMENT_ENABLED=$ENRICHMENT_ENABLED; echo LOCATION_DIAGRAM_MODEL=$LOCATION_DIAGRAM_MODEL; echo MEDIA_DIR=$ENRICHMENT_MEDIA_DIR'

echo "=== enrichment endpoint smoke ==="
BASE="https://partsbazar360.com/api"
PART_ID=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c "
  SELECT cp.id FROM \"CanonicalPart\" cp
  JOIN \"SellerOffer\" so ON so.\"canonicalPartId\"=cp.id
  WHERE so.status='ACTIVE' LIMIT 1;")
echo "part_id=$PART_ID"
curl -sL -o /tmp/enrich.json -w "enrichment_http=%{http_code}\n" \
  "$BASE/search/parts/$PART_ID/enrichment"
python3 -c "import json; d=json.load(open('/tmp/enrich.json')); print({k:d.get(k) for k in ('enrichmentStatus','enrichmentVersion','hasItemSpecifics','locationDiagramUrl','infographicUrl')})"

echo "=== worker recent enrichment lines ==="
sudo docker compose logs --tail=80 worker | grep -iE "enrichment|item.?specific|location.?diagram|EnrichmentProcessor" || echo "(no recent enrichment log lines yet)"

echo
echo "=== DONE e7596c9 item-specifics + location diagrams ==="
