#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db <<'SQL'
-- Column inventory for CanonicalPart enrichment fields
SELECT column_name FROM information_schema.columns
WHERE table_name = 'CanonicalPart'
  AND column_name ILIKE ANY (ARRAY['%brand%','%mpn%','%part%','%spec%','%title%','%categor%','%material%','%position%','%oe%','infographic%'])
ORDER BY column_name;

WITH active_parts AS (
  SELECT
    cp.id,
    MAX(so.price) AS top_price,
    BOOL_OR(cp."infographicSpec" IS NOT NULL) AS has_svg,
    BOOL_OR(cp."itemSpecifics" IS NOT NULL) AS has_specs,
    BOOL_OR(NULLIF(TRIM(COALESCE(cp."brand", '')), '') IS NOT NULL) AS has_brand,
    BOOL_OR(NULLIF(TRIM(COALESCE(cp."manufacturerPartNumber", '')), '') IS NOT NULL) AS has_mpn
  FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
  WHERE so.status = 'ACTIVE'
  GROUP BY cp.id
)
SELECT
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg) AS need_svg,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg AND has_specs) AS need_svg_with_specs,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg AND has_brand AND has_mpn) AS need_svg_brand_mpn,
  count(*) FILTER (WHERE top_price >= 300 AND NOT has_svg AND NOT has_specs AND NOT (has_brand AND has_mpn)) AS need_svg_thin
FROM active_parts;
SQL
