#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== recent worker logs ==="
sudo docker compose logs worker --since 15m 2>&1 | tail -80

echo "=== grep interesting ==="
sudo docker compose logs worker --since 15m 2>&1 | grep -iE 'WARN|ERROR|defer|budget|Infographic|exhausted|circuit|unusable' | tail -40 || true

echo "=== sample recent enriched ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT LEFT(id::text,8) AS id,
  "enrichmentStatus",
  LEFT(COALESCE("enrichmentSource",''),70) AS source,
  ("infographicSpec" IS NOT NULL) AS has_svg,
  ("itemSpecifics" IS NOT NULL) AS has_specs,
  "enrichedAt"
FROM "CanonicalPart"
WHERE "enrichedAt" > NOW() - INTERVAL '15 minutes'
ORDER BY "enrichedAt" DESC
LIMIT 25;

SELECT "enrichmentStatus",
  COUNT(*) AS n,
  COUNT(*) FILTER (WHERE "infographicSpec" IS NOT NULL) AS with_svg,
  COUNT(*) FILTER (WHERE "itemSpecifics" IS NOT NULL) AS with_specs
FROM "CanonicalPart"
WHERE "enrichedAt" > NOW() - INTERVAL '20 minutes'
GROUP BY 1
ORDER BY n DESC;

SELECT LEFT(COALESCE("enrichmentSource",'(null)'),80) AS source, COUNT(*) AS n
FROM "CanonicalPart"
WHERE "enrichedAt" > NOW() - INTERVAL '20 minutes'
GROUP BY 1
ORDER BY n DESC
LIMIT 15;
SQL

echo "=== redis spend + breaker ==="
DAY=$(date -u +%Y-%m-%d)
sudo docker compose exec -T redis redis-cli GET "enrich:spend:${DAY}"
sudo docker compose exec -T redis redis-cli GET enrich:breaker:open
sudo docker compose exec -T redis redis-cli GET enrich:breaker:failures
sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:active
sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized
