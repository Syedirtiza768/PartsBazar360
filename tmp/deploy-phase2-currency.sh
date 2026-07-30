#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"
sudo docker compose build api buyer-marketplace
sudo docker compose up -d api buyer-marketplace
# Reload nginx with updated geo header forwarding
sudo docker compose up -d --force-recreate nginx
sleep 3
curl -sL -o /dev/null -w "buyer=%{http_code}\n" https://partsbazar360.com/buyer/
curl -sL -o /dev/null -w "api_health=%{http_code}\n" https://partsbazar360.com/api/health || true
curl -sL -o /tmp/geo.json -w "geo=%{http_code}\n" https://partsbazar360.com/buyer/api/geo/
python3 -c "import json; print('geo', json.load(open('/tmp/geo.json')))"
echo DONE
