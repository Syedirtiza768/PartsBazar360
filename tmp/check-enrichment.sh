#!/bin/bash
# Observability for the AI enrichment queue: spend against the daily cap,
# circuit-breaker state, queue depth, and how far weight coverage has moved.
set -euo pipefail
cd /home/ubuntu/PartsBazar360

PSQL="sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db"
REDIS="sudo docker compose exec -T redis redis-cli"
DAY=$(date -u +%F)

echo "=== spend (UTC day $DAY) ==="
SPENT=$($REDIS get "enrich:spend:$DAY" | tr -d '\r')
BUDGET=$(grep -E '^ENRICHMENT_DAILY_BUDGET_USD=' .env | cut -d= -f2 || echo 5)
echo "spent=\$${SPENT:-0} of \$${BUDGET:-5}"

echo "=== circuit breaker ==="
echo "open=$($REDIS get enrich:breaker:open | tr -d '\r')"
echo "consecutive_failures=$($REDIS get enrich:breaker:failures | tr -d '\r')"

echo "=== queue depth ==="
for STATE in wait active delayed failed completed; do
  printf "%-10s %s\n" "$STATE" "$($REDIS zcard "bull:enrichment:$STATE" 2>/dev/null | tr -d '\r')"
done
echo "waiting(list) $($REDIS llen bull:enrichment:wait | tr -d '\r')"

echo "=== enrichment status breakdown ==="
$PSQL -c "
  SELECT \"enrichmentStatus\" AS status, count(*) AS parts
  FROM \"CanonicalPart\" GROUP BY 1 ORDER BY 2 DESC;"

echo "=== weight source coverage ==="
$PSQL -c "
  SELECT COALESCE(\"weightSource\",'NONE') AS source,
         count(*) AS parts,
         round(avg(\"weightConfidence\")::numeric, 2) AS avg_confidence,
         round(avg(\"billableWeightKg\")::numeric, 2) AS avg_billable_kg
  FROM \"CanonicalPart\" GROUP BY 1 ORDER BY 2 DESC;"

echo "=== 10 most recent AI-enriched parts ==="
$PSQL -c "
  SELECT left(title, 46) AS title,
         \"partClassKey\" AS class,
         weight AS kg,
         \"weightConfidence\" AS conf,
         \"billableWeightKg\" AS billable,
         \"enrichmentSource\" AS source
  FROM \"CanonicalPart\"
  WHERE \"weightSource\"='AI'
  ORDER BY \"enrichedAt\" DESC NULLS LAST LIMIT 10;"

echo "=== infographics ==="
$PSQL -c "
  SELECT count(*) FILTER (WHERE \"infographicSpec\" IS NOT NULL) AS generated,
         count(*) FILTER (
           WHERE \"infographicSpec\" IS NULL
             AND EXISTS (
               SELECT 1 FROM \"SellerOffer\" so
               WHERE so.\"canonicalPartId\" = cp.id
                 AND so.status = 'ACTIVE'
                 AND so.price >= 300
             )
         ) AS eligible_pending
  FROM \"CanonicalPart\" cp;"

$PSQL -c "
  SELECT left(title, 52) AS title,
         \"infographicVersion\" AS ver,
         \"infographicGeneratedAt\" AS generated_at
  FROM \"CanonicalPart\"
  WHERE \"infographicSpec\" IS NOT NULL
  ORDER BY \"infographicGeneratedAt\" DESC LIMIT 10;"

echo "=== recent worker errors ==="
sudo docker compose logs --tail=300 worker 2>&1 | grep -iE "Enrichment (failed|circuit)|Deferring" | tail -20 || echo "(none)"
