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

# Ensure REVALIDATE_SECRET exists for PDP on-demand cache purge (idempotent).
if ! grep -q '^REVALIDATE_SECRET=' .env 2>/dev/null; then
  SECRET=$(openssl rand -hex 24)
  echo "REVALIDATE_SECRET=$SECRET" >> .env
  echo "Added REVALIDATE_SECRET to .env"
fi

# First boot after years of db push: if migrate deploy fails, fall back once.
export SCHEMA_MODE="${SCHEMA_MODE:-migrate}"

echo "=== rebuild api worker buyer seller nginx ==="
sudo docker compose build api worker buyer-marketplace seller-portal
sudo docker compose up -d api worker buyer-marketplace seller-portal nginx

echo "=== wait for api healthy ==="
for i in $(seq 1 72); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
  echo "api_health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ] && [ "$i" -gt 15 ]; then
    echo "=== api logs ==="
    sudo docker compose logs --tail=120 api
    # Common case: migration history drift after prior db push
    if sudo docker compose logs --tail=80 api | grep -qi 'migrate\|P300[0-9]\|Migration'; then
      echo "Retrying API with SCHEMA_MODE=push once..."
      SCHEMA_MODE=push sudo -E docker compose up -d api
      sleep 20
      STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
      echo "api_health_after_push=$STATUS"
      if [ "$STATUS" != "healthy" ]; then
        sudo docker compose logs --tail=120 api
        exit 1
      fi
      break
    fi
    exit 1
  fi
  sleep 5
done

echo "=== compose ps ==="
sudo docker compose ps

echo "=== smoke ==="
curl -sf https://partsbazar360.realtrackapp.com/api/health; echo
curl -s -o /dev/null -w "home=%{http_code}\n" https://partsbazar360.realtrackapp.com/buyer/
curl -s -o /dev/null -w "search=%{http_code}\n" "https://partsbazar360.realtrackapp.com/buyer/search/?q=brake"
curl -s -o /dev/null -w "seller=%{http_code}\n" https://partsbazar360.realtrackapp.com/seller/

echo "=== worker running? ==="
sudo docker compose ps worker

echo "=== DONE ==="
