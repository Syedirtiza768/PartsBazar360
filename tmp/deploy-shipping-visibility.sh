#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"
test "$(git rev-parse --short HEAD)" = "28d8ee5" || test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"

echo "=== rebuild api + buyer-marketplace ==="
sudo docker compose build api buyer-marketplace
sudo docker compose up -d api buyer-marketplace

echo "=== wait for api healthy ==="
for i in $(seq 1 60); do
  CID=$(sudo docker compose ps -q api)
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$CID" 2>/dev/null || echo starting)
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

echo "=== unit: shipping.service.spec ==="
sudo docker compose exec -T api npx jest src/modules/checkout/shipping.service.spec.ts --runInBand
echo "SHIPPING_UNIT_OK"

BASE="https://partsbazar360.com"
API="$BASE/api"

echo "=== smoke http ==="
curl -sL -o /dev/null -w "buyer_home=%{http_code}\n" "$BASE/buyer/"
curl -sL -o /dev/null -w "buyer_cart=%{http_code}\n" "$BASE/buyer/cart/"
curl -sL -o /dev/null -w "api_health=%{http_code}\n" "$API/health"

echo "=== login ==="
curl -sL -o /tmp/login.json -w "login_status=%{http_code}\n" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@partsbazar360.com","password":"ChangeMe123!"}'
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['accessToken'])")
AUTH="Authorization: Bearer $TOKEN"
echo "token_len=${#TOKEN}"

echo "=== find stocked active offer ==="
OFFER_JSON=$(sudo docker compose exec -T postgres \
  psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT json_build_object(
      'offerId', so.id,
      'price', so.price,
      'currency', so.currency,
      'weight', cp.weight,
      'title', cp.title
    )
   FROM \"SellerOffer\" so
   JOIN \"CanonicalPart\" cp ON cp.id = so.\"canonicalPartId\"
   JOIN \"Seller\" s ON s.id = so.\"sellerId\"
   LEFT JOIN \"Inventory\" i ON i.\"offerId\" = so.id
   WHERE so.status = 'ACTIVE'
     AND s.\"onboardingStatus\" = 'ACTIVE'
     AND so.price > 0
   GROUP BY so.id, cp.weight, cp.title
   HAVING COALESCE(SUM(i.quantity),0) > 0
   ORDER BY so.\"updatedAt\" DESC
   LIMIT 1;")
echo "offer=$OFFER_JSON"
OFFER_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['offerId'])" "$OFFER_JSON")

SESSION_ID="ship-vis-$(date +%s)"
CART_ID=$(curl -sL "$API/cart?sessionId=$SESSION_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -sL -X POST "$API/cart/$CART_ID/items" -H "Content-Type: application/json" \
  -d "{\"offerId\":\"$OFFER_ID\",\"quantity\":1}" >/dev/null

echo "=== quotes ==="
curl -sL -o /tmp/q_uae.json -w "uae=%{http_code}\n" -X POST "$API/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" -d '{"country":"UAE","currency":"AED"}'
curl -sL -o /tmp/q_uk.json -w "uk=%{http_code}\n" -X POST "$API/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" -d '{"country":"United Kingdom","currency":"GBP"}'
curl -sL -o /tmp/q_bad.json -w "blank=%{http_code}\n" -X POST "$API/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" -d '{"country":""}'

python3 - <<'PY'
import json
uae=json.load(open('/tmp/q_uae.json'))
uk=json.load(open('/tmp/q_uk.json'))
checks=[
  ('uae_ship_gt_0', (uae.get('shippingTotal') or 0) > 0),
  ('uae_total_ok', abs((uae.get('totalAmount') or 0) - ((uae.get('subtotal') or 0)+(uae.get('shippingTotal') or 0))) < 0.01),
  ('uk_ship_gt_0', (uk.get('shippingTotal') or 0) > 0),
  ('uk_currency_gbp', uk.get('currency') == 'GBP'),
  ('uae_has_seller_quotes', bool(uae.get('sellerQuotes'))),
]
print(json.dumps({
  'checks': {k:v for k,v in checks},
  'uae': {'ship': uae.get('shippingTotal'), 'total': uae.get('totalAmount'), 'currency': uae.get('currency')},
  'uk': {'ship': uk.get('shippingTotal'), 'total': uk.get('totalAmount'), 'currency': uk.get('currency')},
}, indent=2))
if not all(v for _,v in checks):
  raise SystemExit('LIVE_SHIPPING_CHECKS_FAILED')
print('ALL_LIVE_CHECKS_PASSED')
PY

# Confirm shipping visibility assets are in buyer image
echo "=== buyer image markers ==="
sudo docker compose exec -T buyer-marketplace sh -c 'grep -l useShippingQuote /app/apps/buyer-marketplace/.next/server/app/cart.html 2>/dev/null || grep -R "Ship to country\|use-shipping-quote\|Estimated for" /app -g "*.js" 2>/dev/null | head -5 || ls /app/apps/buyer-marketplace/lib/use-shipping-quote.ts 2>/dev/null || echo "checking built bundles"; find /app -name "*shipping*" 2>/dev/null | head -20'

echo "=== DONE deploy+verify ==="
