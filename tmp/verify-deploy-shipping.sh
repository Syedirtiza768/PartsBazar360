#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
echo "=== columns ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='CanonicalPart' AND column_name IN ('weightSource','partClassKey','infographicSpec','enrichmentStatus','billableWeightKg','dimensionalWeightKg') ORDER BY 1;"
echo "=== weight sources ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c \
  "SELECT COALESCE(\"weightSource\",'NONE') AS source, count(*) AS parts FROM \"CanonicalPart\" GROUP BY 1 ORDER BY 2 DESC;"
echo "=== sample shipping PDP ==="
PART_ID=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT cp.id FROM \"CanonicalPart\" cp JOIN \"SellerOffer\" so ON so.\"canonicalPartId\"=cp.id WHERE so.status='ACTIVE' AND cp.\"billableWeightKg\" IS NOT NULL LIMIT 1;")
echo "part=$PART_ID"
curl -sL "https://partsbazar360.com/api/search/parts/$PART_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('shipping') or {}; print({k:s.get(k) for k in ('state','weightKg','billableWeightKg','weightBasis','source','requiresFreightQuote')}); assert s.get('weightKg'), 'missing weight'"
curl -sL -o /dev/null -w "buyer=%{http_code}\n" https://partsbazar360.com/buyer/
curl -sL -o /dev/null -w "prewarm=%{http_code}\n" -X POST https://partsbazar360.com/api/search/enrichment/prewarm -H "Content-Type: application/json" -d "{\"partIds\":[\"$PART_ID\"]}"
curl -sL -o /dev/null -w "enrichment=%{http_code}\n" "https://partsbazar360.com/api/search/parts/$PART_ID/enrichment"
curl -sL -o /dev/null -w "infographic=%{http_code}\n" "https://partsbazar360.com/api/search/parts/$PART_ID/infographic.svg"
echo DONE
