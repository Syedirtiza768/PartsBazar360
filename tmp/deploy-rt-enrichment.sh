#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
echo "HEAD=$(git rev-parse --short HEAD)"

ENV_FILE=/home/ubuntu/PartsBazar360/.env
touch "$ENV_FILE"
grep -q '^ENRICHMENT_ENABLED=' "$ENV_FILE" && sed -i 's/^ENRICHMENT_ENABLED=.*/ENRICHMENT_ENABLED=1/' "$ENV_FILE" || echo 'ENRICHMENT_ENABLED=1' >> "$ENV_FILE"
grep -q '^ENRICHMENT_PROVIDER=' "$ENV_FILE" && sed -i 's/^ENRICHMENT_PROVIDER=.*/ENRICHMENT_PROVIDER=realtrack/' "$ENV_FILE" || echo 'ENRICHMENT_PROVIDER=realtrack' >> "$ENV_FILE"
grep -q '^ENRICHMENT_PREWARM=' "$ENV_FILE" && sed -i 's/^ENRICHMENT_PREWARM=.*/ENRICHMENT_PREWARM=0/' "$ENV_FILE" || echo 'ENRICHMENT_PREWARM=0' >> "$ENV_FILE"

echo "=== rebuild api + worker ==="
sudo docker compose build api worker
sudo docker compose up -d api worker

for i in $(seq 1 40); do
  CID=$(sudo docker compose ps -q api)
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$CID" 2>/dev/null || echo starting)
  echo "api_health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  sleep 5
done

echo "=== env ==="
sudo docker compose exec -T worker sh -c 'echo PROVIDER=$ENRICHMENT_PROVIDER ENABLED=$ENRICHMENT_ENABLED PREWARM=$ENRICHMENT_PREWARM'

echo "=== smoke: open a RealTrack part (expect QUEUED then DEFERRED until RT ships routes) ==="
PART=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT cp.id FROM \"CanonicalPart\" cp JOIN \"SellerOffer\" so ON so.\"canonicalPartId\"=cp.id WHERE so.status='ACTIVE' AND so.\"externalOfferId\" ~ '^[0-9a-f-]{36}$' LIMIT 1;")
echo "part=$PART"
# reset so it will requeue at v3
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c \
  "UPDATE \"CanonicalPart\" SET \"enrichmentStatus\"='NONE', \"enrichmentVersion\"=0 WHERE id='$PART';"
curl -sL -o /dev/null -w "pdp=%{http_code}\n" "https://partsbazar360.com/api/search/parts/$PART"
sleep 4
curl -sL "https://partsbazar360.com/api/search/parts/$PART/enrichment" | python3 -m json.tool | head -40
sudo docker compose logs --since 2m worker 2>/dev/null | grep -iE "RealTrack|trading|deferred|Enrichment" | tail -20

echo "=== DONE ==="
