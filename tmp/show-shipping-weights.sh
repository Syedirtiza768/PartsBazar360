#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
BASE="https://partsbazar360.com/api"

echo "=== 1) Shipping inputs on CanonicalPart — sample stocked offers ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c "
SELECT
  so.id AS offer_id,
  LEFT(cp.title, 40) AS title,
  cp.weight AS actual_kg,
  cp.\"weightSource\" AS weight_source,
  cp.\"partClassKey\" AS part_class,
  cp.\"dimensionalWeightKg\" AS volumetric_kg,
  cp.\"billableWeightKg\" AS billable_kg,
  cp.dimensions IS NOT NULL AS has_dims,
  so.price,
  so.currency,
  COALESCE(SUM(i.quantity),0) AS stock
FROM \"SellerOffer\" so
JOIN \"CanonicalPart\" cp ON cp.id = so.\"canonicalPartId\"
JOIN \"Seller\" s ON s.id = so.\"sellerId\"
LEFT JOIN \"Inventory\" i ON i.\"offerId\" = so.id
WHERE so.status = 'ACTIVE'
  AND s.\"onboardingStatus\" = 'ACTIVE'
  AND so.price > 0
GROUP BY so.id, cp.title, cp.weight, cp.\"weightSource\", cp.\"partClassKey\",
         cp.\"dimensionalWeightKg\", cp.\"billableWeightKg\", cp.dimensions
HAVING COALESCE(SUM(i.quantity),0) > 0
ORDER BY so.\"updatedAt\" DESC
LIMIT 8;
"

echo \"=== 1b) Weight coverage across the live catalog ===\"
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c "
SELECT
  COALESCE(cp.\"weightSource\", 'NONE') AS weight_source,
  COUNT(*) AS parts,
  ROUND(AVG(cp.weight)::numeric, 2) AS avg_actual_kg,
  COUNT(cp.dimensions) AS with_dimensions
FROM \"CanonicalPart\" cp
GROUP BY COALESCE(cp.\"weightSource\", 'NONE')
ORDER BY parts DESC;
"

OFFER_JSON=$(sudo docker compose exec -T postgres \
  psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT json_build_object(
      'offerId', so.id,
      'price', so.price,
      'currency', so.currency,
      'partId', so.\"canonicalPartId\",
      'weight', cp.weight,
      'title', cp.title,
      'stock', COALESCE(SUM(i.quantity),0)
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

echo "=== selected offer ==="
echo "$OFFER_JSON"
OFFER_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['offerId'])" "$OFFER_JSON")
PART_WEIGHT=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('weight'))" "$OFFER_JSON")
echo "part_weight_kg=$PART_WEIGHT"
echo "(a null weight now resolves to the part-class median, not a flat 1kg;"
echo " the quote response reports weightBasis / weightSource / estimated)"

echo "=== login ==="
curl -sL -o /tmp/login.json -w "login_status=%{http_code}\n" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@partsbazar360.com","password":"ChangeMe123!"}'
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['accessToken'])")
AUTH="Authorization: Bearer $TOKEN"

SESSION_ID="weight-demo-$(date +%s)"
curl -sL -o /tmp/cart.json "$BASE/cart?sessionId=$SESSION_ID"
CART_ID=$(python3 -c "import json; print(json.load(open('/tmp/cart.json'))['id'])")
curl -sL -o /tmp/cart2.json -X POST "$BASE/cart/$CART_ID/items" \
  -H "Content-Type: application/json" \
  -d "{\"offerId\":\"$OFFER_ID\",\"quantity\":1}"
ITEMS=$(python3 -c "import json; print(len(json.load(open('/tmp/cart2.json')).get('items') or []))")
echo "cart_id=$CART_ID items=$ITEMS"

quote_country() {
  local country="$1"
  local out="/tmp/quote_${country// /_}.json"
  curl -sL -o "$out" -w "${country}_status=%{http_code}\n" -X POST "$BASE/checkout/$CART_ID/shipping-quote" \
    -H "Content-Type: application/json" -H "$AUTH" \
    -d "{\"country\":\"$country\"}"
  python3 - <<PY
import json
d=json.load(open("$out"))
print(json.dumps({
  "country": "$country",
  "destinationCountry": d.get("destinationCountry"),
  "currency": d.get("currency"),
  "subtotal": d.get("subtotal"),
  "shippingTotal": d.get("shippingTotal"),
  "totalAmount": d.get("totalAmount"),
  "sellerQuotes": [
    {
      "sellerName": q.get("sellerName"),
      "amount": q.get("amount"),
      "matchedCountry": q.get("matchedCountry"),
      "serviceType": q.get("serviceType"),
      "totalWeightGrams": q.get("totalWeightGrams"),
      "billableWeightGrams": q.get("billableWeightGrams"),
      "weightBasis": q.get("weightBasis"),
      "weightSource": q.get("weightSource"),
      "estimated": q.get("estimated"),
      "marginPct": q.get("marginPct"),
    } for q in d.get("sellerQuotes", [])
  ],
  "error": d.get("message") or d.get("error"),
}, indent=2))
PY
}

echo "=== EXAMPLE 1: United Arab Emirates (flat UAE tiers from same weight) ==="
quote_country "United Arab Emirates"

echo "=== EXAMPLE 2: Australia (EMX country row + billable band from same weight) ==="
quote_country "Australia"

echo "=== EXAMPLE 3: United Kingdom (EMX country row + billable band from same weight) ==="
quote_country "United Kingdom"

echo "=== DONE ==="
echo "Billable weight = max(actual, volumetric); volumetric = L*W*H(cm) / \${SHIPPING_VOLUMETRIC_DIVISOR:-5000}."
echo "Unknown actual weight falls back to the part-class median (see checkout/part-class-weights.ts)."
echo "Unknown dimensions fall back to class typical dims, dampened by SHIPPING_ESTIMATED_VOLUMETRIC_FACTOR."
echo "Estimated weights get a SHIPPING_ESTIMATE_MARGIN_PCT safety margin and report estimated=true."
