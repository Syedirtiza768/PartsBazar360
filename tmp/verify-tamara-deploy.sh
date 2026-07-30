#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
echo "HEAD=$(git rev-parse --short HEAD)"
sudo docker compose exec -T api printenv | awk -F= '/^TAMARA_/ {printf "%s=set(%d)\n", $1, length($2)}'
CODE=$(curl -s -o /tmp/tw.json -w '%{http_code}' -X POST \
  https://partsbazar360.com/api/checkout/webhooks/tamara \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"x","order_reference_id":"y","event_type":"order_approved"}')
echo "webhook_http=$CODE"
head -c 180 /tmp/tw.json; echo
