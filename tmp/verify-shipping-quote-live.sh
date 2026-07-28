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
echo "token_len=${#TOKEN}"

echo "=== find stocked active offer ==="
OFFER_JSON=$(sudo docker compose exec -T postgres \
  psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT json_build_object(
      'offerId', so.id,
      'price', so.price,
      'currency', so.currency,
      'partId', so.\"canonicalPartId\",
      'weight', cp.weight,
      'weightSource', cp.\"weightSource\",
      'partClassKey', cp.\"partClassKey\",
      'billableWeightKg', cp.\"billableWeightKg\",
      'dimensions', cp.dimensions,
      'title', cp.title,
      'stock', COALESCE(SUM(i.quantity),0),
      'sellerStatus', s.\"onboardingStatus\"
    )
   FROM \"SellerOffer\" so
   JOIN \"CanonicalPart\" cp ON cp.id = so.\"canonicalPartId\"
   JOIN \"Seller\" s ON s.id = so.\"sellerId\"
   LEFT JOIN \"Inventory\" i ON i.\"offerId\" = so.id
   WHERE so.status = 'ACTIVE'
     AND s.\"onboardingStatus\" = 'ACTIVE'
     AND so.price > 0
   GROUP BY so.id, cp.weight, cp.\"weightSource\", cp.\"partClassKey\",
            cp.\"billableWeightKg\", cp.dimensions, cp.title,
            s.\"onboardingStatus\"
   HAVING COALESCE(SUM(i.quantity),0) > 0
   ORDER BY so.\"updatedAt\" DESC
   LIMIT 1;")
echo "offer=$OFFER_JSON"
OFFER_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['offerId'])" "$OFFER_JSON")
PART_WEIGHT=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('weight'))" "$OFFER_JSON")
PRICE=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['price'])" "$OFFER_JSON")

echo "=== create cart ==="
SESSION_ID="verify-shipping-$(date +%s)"
curl -sL -o /tmp/cart.json -w "cart_status=%{http_code}\n" \
  "$BASE/cart?sessionId=$SESSION_ID"
CART_ID=$(python3 -c "import json; print(json.load(open('/tmp/cart.json'))['id'])")
echo "cart_id=$CART_ID"

echo "=== add offer to cart ==="
curl -sL -o /tmp/cart2.json -w "add_status=%{http_code}\n" -X POST "$BASE/cart/$CART_ID/items" \
  -H "Content-Type: application/json" \
  -d "{\"offerId\":\"$OFFER_ID\",\"quantity\":1}"
python3 -c "import json; d=json.load(open('/tmp/cart2.json')); print(json.dumps({'items':len(d.get('items',[])), 'message':d.get('message'), 'error':d.get('error')}, indent=2))"

ITEMS=$(python3 -c "import json; print(len(json.load(open('/tmp/cart2.json')).get('items') or []))")
if [ "$ITEMS" = "0" ]; then
  echo "FAILED to add item; aborting quote checks"
  cat /tmp/cart2.json
  exit 1
fi

echo "=== quote United Arab Emirates ==="
curl -sL -o /tmp/quote_uae.json -w "uae_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"country":"United Arab Emirates"}'
python3 - <<'PY'
import json
d=json.load(open('/tmp/quote_uae.json'))
print(json.dumps(d, indent=2)[:2500])
PY

echo "=== quote Australia ==="
curl -sL -o /tmp/quote_au.json -w "au_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"country":"Australia"}'
python3 - <<'PY'
import json
d=json.load(open('/tmp/quote_au.json'))
print(json.dumps({
  'currency': d.get('currency'),
  'destinationCountry': d.get('destinationCountry'),
  'shippingTotal': d.get('shippingTotal'),
  'totalAmount': d.get('totalAmount'),
  'subtotal': d.get('subtotal'),
  'sellerQuotes': [
    {
      'sellerName': q.get('sellerName'),
      'amount': q.get('amount'),
      'matchedCountry': q.get('matchedCountry'),
      'billableWeightGrams': q.get('billableWeightGrams'),
      'totalWeightGrams': q.get('totalWeightGrams'),
      'serviceType': q.get('serviceType'),
      'weightBasis': q.get('weightBasis'),
      'weightSource': q.get('weightSource'),
      'estimated': q.get('estimated'),
      'marginPct': q.get('marginPct'),
    } for q in d.get('sellerQuotes', [])
  ]
}, indent=2))
PY

echo "=== quote Atlantis fallback ==="
curl -sL -o /tmp/quote_atl.json -w "atl_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"country":"Atlantis"}'
python3 - <<'PY'
import json
d=json.load(open('/tmp/quote_atl.json'))
print(json.dumps({
  'currency': d.get('currency'),
  'destinationCountry': d.get('destinationCountry'),
  'shippingTotal': d.get('shippingTotal'),
  'sellerQuotes': [
    {
      'amount': q.get('amount'),
      'matchedCountry': q.get('matchedCountry'),
      'billableWeightGrams': q.get('billableWeightGrams'),
      'serviceType': q.get('serviceType'),
      'weightBasis': q.get('weightBasis'),
      'weightSource': q.get('weightSource'),
    } for q in d.get('sellerQuotes', [])
  ]
}, indent=2))
PY

echo "=== quote empty country ==="
curl -sL -o /tmp/quote_bad.json -w "bad_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"country":""}'
head -c 300 /tmp/quote_bad.json; echo

echo "=== unauth quote ==="
curl -sL -o /tmp/quote_unauth.json -w "unauth_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
  -H "Content-Type: application/json" \
  -d '{"country":"Australia"}'
head -c 200 /tmp/quote_unauth.json; echo

echo "=== billable weight sanity (null weight -> part-class estimate, never 1kg) ==="
echo "part_weight_kg=$PART_WEIGHT"
echo "offer_price=$PRICE"
PART_WEIGHT="$PART_WEIGHT" python3 - <<'PY'
import json, os
au=json.load(open('/tmp/quote_au.json'))
atl=json.load(open('/tmp/quote_atl.json'))
uae=json.load(open('/tmp/quote_uae.json'))

raw_weight = (os.environ.get('PART_WEIGHT') or '').strip()
weight_known = raw_weight not in ('', 'None', 'null')

au_quotes = au.get('sellerQuotes', [])
checks=[]
checks.append(('au_matched', all(q.get('matchedCountry') for q in au_quotes)))
checks.append(('atl_fallback', all(not q.get('matchedCountry') for q in atl.get('sellerQuotes',[]))))
checks.append(('currency_aed', au.get('currency')=='AED'))
checks.append(('au_shipping_gt_0', (au.get('shippingTotal') or 0) > 0))
checks.append(('total_eq_sub_plus_ship', abs((au.get('totalAmount') or 0) - ((au.get('subtotal') or 0)+(au.get('shippingTotal') or 0))) < 0.01))

# New rate-engine contract: every quote reports its basis and data source.
checks.append(('basis_reported', all(q.get('weightBasis') in ('ACTUAL','VOLUMETRIC') for q in au_quotes)))
checks.append(('source_reported', all(q.get('weightSource') for q in au_quotes)))

if weight_known:
    checks.append(('exact_weight_no_margin', all((q.get('marginPct') or 0) == 0 for q in au_quotes)))
else:
    # The legacy engine billed any unknown weight at exactly 1000g. A class
    # estimate must now be used instead, and flagged as an estimate.
    checks.append(('no_legacy_1kg_default', all(q.get('billableWeightGrams') != 1000 for q in au_quotes)))
    checks.append(('billable_above_1kg', all((q.get('billableWeightGrams') or 0) > 1000 for q in au_quotes)))
    checks.append(('source_is_class_default', all(q.get('weightSource') == 'CLASS_DEFAULT' for q in au_quotes)))
    checks.append(('flagged_estimated', all(q.get('estimated') is True for q in au_quotes)))
    checks.append(('margin_applied', all((q.get('marginPct') or 0) > 0 for q in au_quotes)))

print(json.dumps({
  'weight_known': weight_known,
  'checks': {k:v for k,v in checks},
  'uae_ship': uae.get('shippingTotal'),
  'au_ship': au.get('shippingTotal'),
  'atl_ship': atl.get('shippingTotal'),
  'au_billable_grams': [q.get('billableWeightGrams') for q in au_quotes],
}, indent=2))
failed=[k for k,v in checks if not v]
if failed:
  raise SystemExit('live shipping checks failed: ' + ', '.join(failed))
print('ALL_CHECKS_PASSED')
PY

echo "=== DONE ==="
