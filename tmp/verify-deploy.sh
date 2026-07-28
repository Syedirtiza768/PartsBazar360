#!/bin/bash
set -e
cd /home/ubuntu/PartsBazar360
echo "HEAD=$(git rev-parse --short HEAD)"
echo "=== health ==="
curl -sf https://partsbazar360.realtrackapp.com/api/health
echo
echo "=== pages ==="
curl -s -o /dev/null -w "buyer-login:%{http_code}\n" https://partsbazar360.realtrackapp.com/buyer/login/
curl -s -o /dev/null -w "admin-login:%{http_code}\n" https://partsbazar360.realtrackapp.com/admin/login/
echo "=== auth login ==="
curl -s -X POST http://127.0.0.1:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"buyer@partsbazar360.com","password":"ChangeMe123!"}' \
  | head -c 400
echo
# hit via nginx too
curl -s -X POST https://partsbazar360.realtrackapp.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"buyer@partsbazar360.com","password":"ChangeMe123!"}' \
  | head -c 400
echo
echo "=== stripe env ==="
LEN=$(sudo docker compose exec -T api printenv STRIPE_SECRET_KEY | tr -d '\r\n' | wc -c)
echo "STRIPE_SECRET_KEY_LEN=$LEN"
sudo docker compose exec -T api printenv BUYER_APP_URL
