#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
PSQL='sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db'

echo "=== coverage ==="
$PSQL -c 'SELECT count(*) FILTER (WHERE "partClassKey" IS NOT NULL) AS with_class, count(*) FILTER (WHERE "billableWeightKg" IS NOT NULL) AS with_billable, count(*) FILTER (WHERE weight IS NOT NULL) AS with_weight, count(*) AS total FROM "CanonicalPart";'

echo "=== offer join columns ==="
$PSQL -c '\d "SellerOffer"' | head -40

PART_ID=$($PSQL -t -A -c 'SELECT cp.id FROM "CanonicalPart" cp JOIN "SellerOffer" so ON so."canonicalPartId"=cp.id WHERE so.status='"'"'ACTIVE'"'"' AND cp."billableWeightKg" IS NOT NULL LIMIT 1;')
if [ -z "$PART_ID" ]; then
  PART_ID=$($PSQL -t -A -c 'SELECT cp.id FROM "CanonicalPart" cp JOIN "SellerOffer" so ON so."partId"=cp.id WHERE so.status='"'"'ACTIVE'"'"' LIMIT 1;')
fi
if [ -z "$PART_ID" ]; then
  PART_ID=$($PSQL -t -A -c 'SELECT id FROM "CanonicalPart" WHERE "billableWeightKg" IS NOT NULL LIMIT 1;')
fi
echo "part=$PART_ID"

curl -sL "https://partsbazar360.com/api/search/parts/$PART_ID" -o /tmp/part.json -w "part_http=%{http_code}\n"
python3 -c "import json; d=json.load(open('/tmp/part.json')); s=d.get('shipping') or {}; print('shipping', {k:s.get(k) for k in ('state','weightKg','billableWeightKg','weightBasis','source','requiresFreightQuote')}); assert s.get('billableWeightKg'), d"
curl -sL -o /dev/null -w "buyer=%{http_code}\n" https://partsbazar360.com/buyer/
curl -sL -o /dev/null -w "prewarm=%{http_code}\n" -X POST https://partsbazar360.com/api/search/enrichment/prewarm -H "Content-Type: application/json" -d "{\"partIds\":[\"$PART_ID\"]}"
curl -sL -o /tmp/enrich.json -w "enrichment=%{http_code}\n" "https://partsbazar360.com/api/search/parts/$PART_ID/enrichment"
python3 -c "import json; print('enrichment', json.load(open('/tmp/enrich.json')))"
curl -sL -o /dev/null -w "infographic=%{http_code}\n" "https://partsbazar360.com/api/search/parts/$PART_ID/infographic.svg"
echo DONE
