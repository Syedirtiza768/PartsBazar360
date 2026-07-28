#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
set -a
# shellcheck disable=SC1091
source ./.env
set +a

curl -sS https://api.stripe.com/v1/webhook_endpoints \
  -u "${STRIPE_SECRET_KEY}:" \
  -d "url=https://partsbazar360.realtrackapp.com/api/checkout/webhooks/stripe" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=checkout.session.expired" \
  -d "description=PartsBazar360 checkout" \
  > /tmp/stripe_webhook.json

python3 <<'PY'
import json
d=json.load(open("/tmp/stripe_webhook.json"))
err=(d.get("error") or {}).get("message","")
print(f"id={d.get('id','')}")
print(f"status={d.get('status','')}")
print(f"has_secret={bool(d.get('secret'))}")
print(f"error={err}")
open("/tmp/stripe_webhook_secret.txt","w").write(d.get("secret") or "")
PY

SECRET=$(cat /tmp/stripe_webhook_secret.txt)
rm -f /tmp/stripe_webhook_secret.txt /tmp/stripe_webhook.json
if [ -z "$SECRET" ]; then
  echo "WEBHOOK_CREATE_FAILED"
  exit 1
fi

if grep -q "^STRIPE_WEBHOOK_SECRET=" .env; then
  sed -i "s|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=${SECRET}|" .env
else
  echo "STRIPE_WEBHOOK_SECRET=${SECRET}" >> .env
fi

sudo docker compose up -d api
sleep 8
WLEN=$(sudo docker compose exec -T api printenv STRIPE_WEBHOOK_SECRET | tr -d '\r\n' | wc -c)
echo "STRIPE_WEBHOOK_SECRET_LEN=${WLEN}"
curl -sf https://partsbazar360.realtrackapp.com/api/health
echo
