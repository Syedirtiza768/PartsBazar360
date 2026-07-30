#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

LISTING_ID=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT so.\"externalOfferId\" FROM \"SellerOffer\" so WHERE so.\"externalOfferId\" IS NOT NULL AND so.\"externalOfferId\" ~ '^[0-9a-f-]{36}$' AND so.status='ACTIVE' LIMIT 1;")
EBAY_ID=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT cp.\"ebayItemId\" FROM \"SellerOffer\" so JOIN \"CanonicalPart\" cp ON cp.id=so.\"canonicalPartId\" WHERE so.\"externalOfferId\"='$LISTING_ID' LIMIT 1;")
echo "listing_id=$LISTING_ID ebay=$EBAY_ID"

sudo docker compose exec -T worker printenv REALTRACK_API_URL > /tmp/rt_url
sudo docker compose exec -T worker printenv REALTRACK_API_EMAIL > /tmp/rt_email
sudo docker compose exec -T worker printenv REALTRACK_API_PASSWORD > /tmp/rt_pass
BASE=$(tr -d '\r\n' </tmp/rt_url)
BASE="${BASE%/}"

python3 <<PY
import json, urllib.request, urllib.error

base = "$BASE"
email = open("/tmp/rt_email").read().strip().replace("\r","")
password = open("/tmp/rt_pass").read().strip().replace("\r","")
listing_id = "$LISTING_ID"
ebay_id = "$EBAY_ID"

req = urllib.request.Request(
    f"{base}/auth/login",
    data=json.dumps({"email": email, "password": password}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as res:
    me = json.load(res)
    token = me["accessToken"]
print("login ok; keys", sorted(me.keys()))

# /auth/me for permissions
try:
    r = urllib.request.Request(f"{base}/auth/me", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(r, timeout=30) as res:
        print("me:", json.dumps(json.load(res), indent=2)[:1500])
except Exception as e:
    print("me failed", e)

paths = [
    f"/published-listings/trading-enrichment/budget",
    f"/published-listings/{listing_id}/trading-enrichment",
    f"/published-listings/{ebay_id}/trading-enrichment",
    f"/trading-enrichment/budget",
    f"/trading-enrichment/{listing_id}",
    f"/published-listings/{listing_id}/enrichment",
    f"/published-listings/{listing_id}/tradingEnrichment",
]

def hit(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        f"{base}{path}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(r, timeout=120) as res:
            raw = res.read()
            print(f"OK {method} {path} http={res.status} bytes={len(raw)}")
            try:
                d = json.loads(raw)
                print(json.dumps(d, indent=2)[:2500])
                open("/tmp/rt-enrich.json","w").write(json.dumps(d, indent=2))
            except Exception:
                print(raw[:500])
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")[:500]
        print(f"ERR {method} {path} http={e.code} body={body}")

for p in paths:
    hit("GET", p)

# batch
hit("POST", "/published-listings/trading-enrichment/batch", {"ids": [listing_id]})
hit("POST", "/published-listings/trading-enrichment/batch", {"listingIds": [listing_id]})
PY
