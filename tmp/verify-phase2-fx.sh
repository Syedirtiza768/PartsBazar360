#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
BASE="https://partsbazar360.com/api"

echo "=== login ==="
curl -sL -o /tmp/login.json -w "login_status=%{http_code}\n" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@partsbazar360.com","password":"ChangeMe123!"}'
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['accessToken'])")
AUTH="Authorization: Bearer $TOKEN"

echo "=== find stocked offer ==="
OFFER_JSON=$(sudo docker compose exec -T postgres \
  psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT json_build_object('offerId', so.id, 'price', so.price, 'currency', so.currency)
   FROM \"SellerOffer\" so
   JOIN \"Seller\" s ON s.id = so.\"sellerId\"
   LEFT JOIN \"Inventory\" i ON i.\"offerId\" = so.id
   WHERE so.status = 'ACTIVE' AND s.\"onboardingStatus\" = 'ACTIVE' AND so.price > 0
   GROUP BY so.id
   HAVING COALESCE(SUM(i.quantity),0) > 0
   ORDER BY so.\"updatedAt\" DESC LIMIT 1;")
OFFER_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['offerId'])" "$OFFER_JSON")
echo "offer=$OFFER_JSON"

SESSION_ID="verify-fx-$(date +%s)"
curl -sL -o /tmp/cart.json "$BASE/cart?sessionId=$SESSION_ID"
CART_ID=$(python3 -c "import json; print(json.load(open('/tmp/cart.json'))['id'])")
curl -sL -o /tmp/cart2.json -X POST "$BASE/cart/$CART_ID/items" \
  -H "Content-Type: application/json" \
  -d "{\"offerId\":\"$OFFER_ID\",\"quantity\":1}"

echo "=== AED quote UAE ==="
curl -sL -o /tmp/q_aed.json -w "aed_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"country":"United Arab Emirates","currency":"AED"}'

echo "=== USD quote UAE ==="
curl -sL -o /tmp/q_usd.json -w "usd_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"country":"United Arab Emirates","currency":"USD"}'

python3 - <<'PY'
import json
aed=json.load(open('/tmp/q_aed.json'))
usd=json.load(open('/tmp/q_usd.json'))
print('AED', {k:aed.get(k) for k in ['currency','settlementCurrency','subtotal','shippingTotal','totalAmount']})
print('USD', {k:usd.get(k) for k in ['currency','settlementCurrency','subtotal','shippingTotal','totalAmount']})
# UAE <=2kg flat 20 AED -> ~5.45 USD at 3.6725
ship_aed=aed.get('shippingTotal') or 0
ship_usd=usd.get('shippingTotal') or 0
expected_usd=round(ship_aed/3.6725, 2)
ok = (
  aed.get('currency')=='AED'
  and usd.get('currency')=='USD'
  and usd.get('settlementCurrency')=='AED'
  and abs(ship_usd-expected_usd) < 0.02
  and ship_aed > 0
)
print(json.dumps({
  'ship_aed': ship_aed,
  'ship_usd': ship_usd,
  'expected_usd': expected_usd,
  'ok': ok,
}, indent=2))
if not ok:
  raise SystemExit('FX quote checks failed')
print('ALL_CHECKS_PASSED')
PY
