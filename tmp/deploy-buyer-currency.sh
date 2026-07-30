#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"
sudo docker compose build buyer-marketplace
sudo docker compose up -d buyer-marketplace
curl -sL -o /dev/null -w "buyer=%{http_code}\n" https://partsbazar360.com/buyer/
curl -sL -o /tmp/geo.json -w "geo=%{http_code}\n" https://partsbazar360.com/buyer/api/geo/
python3 -c "import json; print(json.load(open('/tmp/geo.json')))"
echo DONE
