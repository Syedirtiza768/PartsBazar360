#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"
echo "MSG=$(git log -1 --pretty=%s)"

if [ ! -f .env ]; then
  echo "ERROR: .env missing"
  exit 1
fi

echo "=== rebuild api + buyer-marketplace ==="
sudo docker compose build api buyer-marketplace
sudo docker compose up -d api buyer-marketplace

echo "=== wait for api healthy ==="
for i in $(seq 1 60); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
  echo "api_health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ] && [ "$i" -gt 12 ]; then
    sudo docker compose logs --tail=80 api
    exit 1
  fi
  sleep 5
done

echo "=== compose ps ==="
sudo docker compose ps

echo "=== smoke ==="
curl -sf https://partsbazar360.realtrackapp.com/api/health; echo
curl -s -o /dev/null -w "home=%{http_code}\n" https://partsbazar360.realtrackapp.com/buyer/
curl -s -o /dev/null -w "stale_pdp=%{http_code}\n" "https://partsbazar360.realtrackapp.com/buyer/part/6f3f8d2a-5bf1-49e0-aede-7668a17bc826/?cb=$(date +%s)"
curl -s "https://partsbazar360.realtrackapp.com/buyer/part/6f3f8d2a-5bf1-49e0-aede-7668a17bc826/?cb=$(date +%s)" \
  | grep -oE 'Part Not Found' | head -1 || echo "stale_body=missing_not_found"

echo "=== DONE ==="
