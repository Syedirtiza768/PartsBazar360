#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== patch processor on server tree ==="
cp /tmp/enrichment.processor.ts apps/api/src/modules/enrichment/enrichment.processor.ts

# Keep batch-friendly env
ENVF=.env
grep -q '^ENRICHMENT_CONCURRENCY=' "$ENVF" && sed -i 's/^ENRICHMENT_CONCURRENCY=.*/ENRICHMENT_CONCURRENCY=1/' "$ENVF" || echo 'ENRICHMENT_CONCURRENCY=1' >> "$ENVF"
grep -q '^LOCATION_DIAGRAM_MIN_PRICE_USD=' "$ENVF" && sed -i 's/^LOCATION_DIAGRAM_MIN_PRICE_USD=.*/LOCATION_DIAGRAM_MIN_PRICE_USD=999999/' "$ENVF" || echo 'LOCATION_DIAGRAM_MIN_PRICE_USD=999999' >> "$ENVF"
grep -q '^ENRICHMENT_DAILY_BUDGET_USD=' "$ENVF" && sed -i 's/^ENRICHMENT_DAILY_BUDGET_USD=.*/ENRICHMENT_DAILY_BUDGET_USD=25/' "$ENVF" || echo 'ENRICHMENT_DAILY_BUDGET_USD=25' >> "$ENVF"
grep -q '^ENRICHMENT_PREWARM=' "$ENVF" && sed -i 's/^ENRICHMENT_PREWARM=.*/ENRICHMENT_PREWARM=0/' "$ENVF" || echo 'ENRICHMENT_PREWARM=0' >> "$ENVF"

echo "=== rebuild worker ==="
sudo docker compose build worker
sudo docker compose up -d worker
sleep 8
sudo docker compose exec -T worker sh -c 'echo CONC=$ENRICHMENT_CONCURRENCY DIAG=$LOCATION_DIAGRAM_MIN_PRICE_USD BUDGET=$ENRICHMENT_DAILY_BUDGET_USD'
sudo docker compose logs worker --tail 15
