#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"

echo "=== rebuild buyer-marketplace ==="
sudo docker compose build buyer-marketplace
sudo docker compose up -d buyer-marketplace
sleep 5

echo "=== smoke ==="
curl -s -o /dev/null -w "home=%{http_code}\n" https://partsbazar360.realtrackapp.com/buyer/
curl -s -o /dev/null -w "stale=%{http_code}\n" "https://partsbazar360.realtrackapp.com/api/search/parts/3ff833f2-ce19-4c05-951a-daf10f91fc25"
echo "=== DONE ==="
