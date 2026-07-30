#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
BASE="https://partsbazar360.com/api"

curl -sL -o /tmp/login.json -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"buyer@partsbazar360.com","password":"ChangeMe123!"}'
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['accessToken'])")
AUTH="Authorization: Bearer $TOKEN"

OFFER_ID=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT so.id FROM \"SellerOffer\" so JOIN \"Seller\" s ON s.id=so.\"sellerId\" JOIN \"Inventory\" i ON i.\"offerId\"=so.id WHERE so.status='ACTIVE' AND s.\"onboardingStatus\"='ACTIVE' AND i.quantity>0 LIMIT 1;")
SESSION_ID="blank-country-$(date +%s)"
CART_ID=$(curl -sL "$BASE/cart?sessionId=$SESSION_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -sL -X POST "$BASE/cart/$CART_ID/items" -H "Content-Type: application/json" \
  -d "{\"offerId\":\"$OFFER_ID\",\"quantity\":1}" >/dev/null

echo "=== blank country ==="
curl -sL -o /tmp/blank.json -w "blank_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" -d '{"country":""}'
cat /tmp/blank.json; echo

echo "=== whitespace country ==="
curl -sL -o /tmp/ws.json -w "ws_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" -d '{"country":"   "}'
cat /tmp/ws.json; echo

echo "=== australia still works ==="
curl -sL -o /tmp/au.json -w "au_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" -d '{"country":"Australia"}'
python3 -c "import json; d=json.load(open('/tmp/au.json')); print({'destinationCountry':d.get('destinationCountry'),'shippingTotal':d.get('shippingTotal'),'matched': (d.get('sellerQuotes') or [{}])[0].get('matchedCountry')})"
