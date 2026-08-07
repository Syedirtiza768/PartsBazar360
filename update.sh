#!/bin/bash
# Quick update script - pull latest changes and rebuild
set -e
cd /home/ubuntu/PartsBazar360

echo "Pulling latest changes..."
git pull origin main

echo "Rebuilding and restarting services..."
docker compose up -d --build

# nginx.conf is bind-mounted, and app containers get new IPs on every
# recreate above. Reload so nginx (a) picks up any nginx.conf change and
# (b) drops any upstream connections it was holding open to the old
# container IPs — otherwise requests can keep landing on whatever service
# used to own that pooled connection until nginx is reloaded or restarted.
echo "Reloading nginx..."
docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload

echo "Update complete! Application is running at https://partsbazar360.com"
