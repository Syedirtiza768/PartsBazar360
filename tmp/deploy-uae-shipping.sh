#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"

echo "=== rebuild api ==="
sudo docker compose build api
sudo docker compose up -d api

for i in $(seq 1 40); do
  CID=$(sudo docker compose ps -q api)
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$CID" 2>/dev/null || echo starting)
  echo "api_health=$STATUS ($i)"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "unhealthy" ] && [ "$i" -gt 10 ]; then
    sudo docker compose logs --tail=60 api
    exit 1
  fi
  sleep 5
done

BASE="https://partsbazar360.com/api"
curl -sL -o /tmp/login.json -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"buyer@partsbazar360.com","password":"ChangeMe123!"}'
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['accessToken'])")
AUTH="Authorization: Bearer $TOKEN"

OFFER_ID=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT so.id FROM \"SellerOffer\" so JOIN \"Seller\" s ON s.id=so.\"sellerId\" JOIN \"Inventory\" i ON i.\"offerId\"=so.id WHERE so.status='ACTIVE' AND s.\"onboardingStatus\"='ACTIVE' AND i.quantity>0 LIMIT 1;")
SESSION_ID="uae-flat-$(date +%s)"
CART_ID=$(curl -sL "$BASE/cart?sessionId=$SESSION_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -sL -X POST "$BASE/cart/$CART_ID/items" -H "Content-Type: application/json" \
  -d "{\"offerId\":\"$OFFER_ID\",\"quantity\":1}" >/dev/null

echo "=== UAE quote (default 1kg missing weight -> small 20 AED) ==="
curl -sL -o /tmp/uae.json -w "uae_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" -d '{"country":"United Arab Emirates"}'
python3 -c "import json; d=json.load(open('/tmp/uae.json')); q=(d.get('sellerQuotes') or [{}])[0]; print({'destinationCountry':d.get('destinationCountry'),'shippingTotal':d.get('shippingTotal'),'matched':q.get('matchedCountry'),'serviceType':q.get('serviceType'),'amount':q.get('amount')})"

echo "=== UAE alias ==="
curl -sL -o /tmp/uae2.json -w "alias_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" -d '{"country":"UAE"}'
python3 -c "import json; d=json.load(open('/tmp/uae2.json')); print({'shippingTotal':d.get('shippingTotal'),'service':(d.get('sellerQuotes') or [{}])[0].get('serviceType')})"

echo "=== DONE ==="
