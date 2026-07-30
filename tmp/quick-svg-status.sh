#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
echo "=== throttle ==="
tail -15 /home/ubuntu/svg-throttle.log
echo "=== worker warns ==="
sudo docker compose logs worker --since 5m 2>&1 | grep -iE '429|WARN|infographic|rate-limited' | tail -25 || true
echo "=== counts ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
WITH ap AS (
  SELECT cp.id,
    MAX(so.price) AS top_price,
    BOOL_OR(cp."infographicSpec" IS NOT NULL) AS has_svg,
    MAX(cp."enrichmentStatus") AS status
  FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId"=cp.id
  WHERE so.status='ACTIVE'
  GROUP BY cp.id
)
SELECT
  count(*) FILTER (WHERE top_price>=300 AND has_svg) AS have_svg,
  count(*) FILTER (WHERE top_price>=300 AND NOT has_svg) AS need_svg,
  count(*) FILTER (WHERE top_price>=300 AND status='DEFERRED') AS deferred,
  count(*) FILTER (WHERE top_price>=300 AND status='QUEUED') AS queued,
  count(*) FILTER (WHERE top_price>=300 AND status='RUNNING') AS running,
  count(*) FILTER (WHERE top_price>=300 AND status='DONE') AS done
FROM ap;
SQL
DAY=$(date -u +%Y-%m-%d)
echo -n "spend="; sudo docker compose exec -T redis redis-cli GET "enrich:spend:${DAY}" | tr -d '\r'
echo -n "wait="; sudo docker compose exec -T redis redis-cli ZCARD bull:enrichment:prioritized | tr -d '\r'
echo -n "active="; sudo docker compose exec -T redis redis-cli LLEN bull:enrichment:active | tr -d '\r'
pgrep -af throttle-svg || echo 'throttle not running'
