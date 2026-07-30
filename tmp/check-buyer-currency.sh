#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
sudo docker compose exec -T nginx nginx -s reload || true
for i in $(seq 1 12); do
  code=$(curl -sL -o /dev/null -w '%{http_code}' https://partsbazar360.com/buyer/ || true)
  echo "try$i=$code"
  if [ "$code" = "200" ]; then break; fi
  sleep 4
done
echo "=== geo ==="
curl -sL -w '\ngeo=%{http_code}\n' https://partsbazar360.com/buyer/api/geo/ || true
sudo docker compose ps buyer-marketplace
