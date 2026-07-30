#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
-- Active listings with top offer price > $300 (USD stored on SellerOffer.price)
WITH active_parts AS (
  SELECT
    cp.id,
    MAX(so.price) AS top_price,
    BOOL_OR(cp."infographicSpec" IS NOT NULL) AS has_svg,
    MAX(cp."enrichmentStatus") AS enrichment_status,
    BOOL_OR(cp."itemSpecifics" IS NOT NULL) AS has_specs
  FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
  WHERE so.status = 'ACTIVE'
  GROUP BY cp.id
)
SELECT
  count(*) FILTER (WHERE top_price >= 300) AS parts_ge_300,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg) AS need_svg,
  count(*) FILTER (WHERE top_price >= 300 AND has_svg) AS already_have_svg,
  count(*) FILTER (WHERE top_price >= 300 AND has_specs) AS ge_300_with_specs,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_specs) AS ge_300_missing_specs,
  round(avg(top_price) FILTER (WHERE top_price >= 300)::numeric, 2) AS avg_price_ge_300,
  round(min(top_price) FILTER (WHERE top_price >= 300)::numeric, 2) AS min_price_ge_300,
  round(max(top_price) FILTER (WHERE top_price >= 300)::numeric, 2) AS max_price_ge_300
FROM active_parts;

-- Price bands for context
WITH active_parts AS (
  SELECT cp.id, MAX(so.price) AS top_price,
         BOOL_OR(cp."infographicSpec" IS NOT NULL) AS has_svg
  FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
  WHERE so.status = 'ACTIVE'
  GROUP BY cp.id
)
SELECT
  CASE
    WHEN top_price >= 1000 THEN '1000+'
    WHEN top_price >= 500 THEN '500-999'
    WHEN top_price >= 300 THEN '300-499'
    ELSE 'under_300'
  END AS band,
  count(*) AS parts,
  count(*) FILTER (WHERE NOT has_svg) AS need_svg
FROM active_parts
GROUP BY 1
ORDER BY 1;
SQL

# Confirm threshold env
sudo docker compose exec -T worker sh -c 'echo INFOGRAPHIC_MIN=$INFOGRAPHIC_MIN_PRICE_USD; echo INFOGRAPHIC_MODEL=$INFOGRAPHIC_MODEL; echo KEY_SET=$([ -n "$OPENROUTER_API_KEY" ] && echo yes || echo no)'
