#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"

if [ ! -f .env ]; then
  echo "ERROR: .env missing (Stripe keys)"
  exit 1
fi
echo "=== .env keys present ==="
grep -E '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PUBLISHABLE_KEY|BUYER_APP_URL|AUTH_JWT_SECRET)=' .env \
  | sed -E 's/=.+/=***/'

echo "=== docker compose rebuild ==="
sudo docker compose up -d --build

echo "=== wait for api healthy ==="
for i in $(seq 1 60); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
  echo "api_health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ] && [ "$i" -gt 10 ]; then
    sudo docker compose logs --tail=50 api
    exit 1
  fi
  sleep 5
done

echo "=== compose ps ==="
sudo docker compose ps

echo "=== smoke ==="
curl -sf https://partsbazar360.realtrackapp.com/api/health; echo
curl -s -o /dev/null -w "buyer-login:%{http_code}\n" https://partsbazar360.realtrackapp.com/buyer/login/
curl -s -o /dev/null -w "admin-login:%{http_code}\n" https://partsbazar360.realtrackapp.com/admin/login/
curl -s -X POST https://partsbazar360.realtrackapp.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"buyer@partsbazar360.com","password":"ChangeMe123!"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('auth_ok='+str(bool(d.get('accessToken')))); print('role='+str((d.get('user') or {}).get('role')))"

LEN=$(sudo docker compose exec -T api printenv STRIPE_SECRET_KEY | tr -d '\r\n' | wc -c)
WLEN=$(sudo docker compose exec -T api printenv STRIPE_WEBHOOK_SECRET | tr -d '\r\n' | wc -c)
echo "STRIPE_SECRET_KEY_LEN=$LEN"
echo "STRIPE_WEBHOOK_SECRET_LEN=$WLEN"
sudo docker compose exec -T api printenv BUYER_APP_URL
echo "=== DONE ==="
