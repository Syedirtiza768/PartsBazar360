#!/bin/bash
# Deploys Phases 1-4 of the shipping weight work:
#   - seller weight/dimension capture from spreadsheets
#   - part-class table + volumetric (billable) weight + freight ceiling
#   - three-state shipping contract on the PDP
#   - AI enrichment queue/worker (shipped DISABLED; see the flip step at the end)
#   - spec-card infographics for parts >= $300, rendered as SVG on demand
#
# Migration is applied by the api container entrypoint (prisma migrate deploy).
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"

echo "=== rebuild api + worker + buyer ==="
sudo docker compose build api worker buyer-marketplace
sudo docker compose up -d api worker buyer-marketplace

echo "=== wait for api health (migration runs on boot) ==="
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

PSQL="sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db"

echo "=== confirm migration applied ==="
$PSQL -t -A -c "
  SELECT string_agg(column_name, ',' ORDER BY column_name)
  FROM information_schema.columns
  WHERE table_name='CanonicalPart'
    AND column_name IN ('weightSource','weightConfidence','partClassKey',
                        'dimensionalWeightKg','billableWeightKg',
                        'enrichmentStatus','enrichmentVersion',
                        'infographicSpec','infographicVersion',
                        'infographicGeneratedAt');"
echo "(expect all 10 columns above)"

echo "=== backfill dry run ==="
sudo docker compose exec -T api node scripts/backfill-part-class-weights.mjs --dry-run

if [ "${APPLY_BACKFILL:-1}" = "1" ]; then
  echo "=== backfill apply ==="
  sudo docker compose exec -T api node scripts/backfill-part-class-weights.mjs
else
  echo "Skipped backfill (APPLY_BACKFILL=0)."
fi

echo "=== weight coverage after backfill ==="
$PSQL -c "
  SELECT COALESCE(\"weightSource\", 'NONE') AS source,
         count(*) AS parts,
         round(avg(\"billableWeightKg\")::numeric, 2) AS avg_billable_kg
  FROM \"CanonicalPart\"
  GROUP BY 1 ORDER BY 2 DESC;"

echo "=== freight-flagged parts (over the 30kg parcel ceiling) ==="
$PSQL -t -A -c "
  SELECT count(*) FROM \"CanonicalPart\"
  WHERE \"billableWeightKg\" > 30;"

echo "=== PDP shipping contract ==="
BASE="https://partsbazar360.com/api"
PART_ID=$($PSQL -t -A -c "
  SELECT cp.id FROM \"CanonicalPart\" cp
  JOIN \"SellerOffer\" so ON so.\"partId\"=cp.id
  WHERE so.status='ACTIVE' LIMIT 1;")
echo "part_id=$PART_ID"

curl -sL -o /tmp/part.json -w "part_status=%{http_code}\n" "$BASE/search/parts/$PART_ID"
python3 -c "
import json; d=json.load(open('/tmp/part.json')); s=d.get('shipping') or {}
print('shipping:', {k: s.get(k) for k in ('state','weightKg','weightBasis','weightSource','requiresFreightQuote','estimated')})
assert s.get('state') in ('exact','estimated','pending'), 'missing three-state shipping contract'
assert s.get('weightKg'), 'no weight resolved — PDP would fall back to the old 1kg default'
print('OK: PDP renders a shipping figure on first paint')
"

curl -sL -o /tmp/enrich.json -w "enrichment_status=%{http_code}\n" \
  "$BASE/search/parts/$PART_ID/enrichment"
python3 -c "import json; print('enrichment:', json.load(open('/tmp/enrich.json')))"

echo "=== infographic route ==="
# 404 is the correct answer until a part >= $300 has been enriched.
INFO_ID=$($PSQL -t -A -c "
  SELECT id FROM \"CanonicalPart\"
  WHERE \"infographicSpec\" IS NOT NULL LIMIT 1;")
if [ -n "$INFO_ID" ]; then
  curl -sL -o /tmp/info.svg -w "infographic=%{http_code} type=%{content_type} bytes=%{size_download}\n" \
    "$BASE/search/parts/$INFO_ID/infographic.svg"
  head -c 120 /tmp/info.svg; echo
  echo "preview: https://partsbazar360.com/api/search/parts/$INFO_ID/infographic.svg"
else
  echo "(no infographics generated yet — expected before enrichment is enabled)"
  curl -sL -o /dev/null -w "infographic_404_check=%{http_code} (expect 404)\n" \
    "$BASE/search/parts/$PART_ID/infographic.svg"
fi

echo "=== enrichment worker registered? ==="
sudo docker compose logs --tail=200 worker | grep -iE "enrichment|EnrichmentProcessor" || \
  echo "(no enrichment log lines — expected while ENRICHMENT_ENABLED=0)"

echo
echo "=== DONE (phases 1-6 deployed) ==="
echo "AI enrichment is OFF by default. To turn it on, add to /home/ubuntu/PartsBazar360/.env:"
echo "  OPENROUTER_API_KEY=sk-or-..."
echo "  ENRICHMENT_ENABLED=1"
echo "  ENRICHMENT_DAILY_BUDGET_USD=5"
echo "  INFOGRAPHIC_MIN_PRICE_USD=300"
echo "then: sudo docker compose up -d api worker"
echo "Watch spend with: bash tmp/check-enrichment.sh"
