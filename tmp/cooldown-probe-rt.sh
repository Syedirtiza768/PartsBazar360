#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== kill throttle ==="
sudo pkill -f 'throttle-svg-batch.cjs' 2>/dev/null || true
sleep 2
pgrep -af throttle-svg || echo 'throttle stopped'

echo "=== drain any leftover enrichment jobs ==="
sudo docker compose exec -T redis redis-cli ZREMRANGEBYRANK bull:enrichment:prioritized 0 -1
sudo docker compose exec -T redis redis-cli DEL bull:enrichment:wait || true

echo "=== wait 5 min for RealTrack rate limit to cool (no RT calls) ==="
sleep 300

echo "=== probe one trading-enrichment call ==="
sudo docker compose exec -T worker printenv REALTRACK_API_URL > /tmp/rt_url
sudo docker compose exec -T worker printenv REALTRACK_API_EMAIL > /tmp/rt_email
sudo docker compose exec -T worker printenv REALTRACK_API_PASSWORD > /tmp/rt_pass

LISTING=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A <<'SQL'
SELECT so."externalOfferId"
FROM "SellerOffer" so
JOIN "CanonicalPart" cp ON cp.id = so."canonicalPartId"
WHERE so.status = 'ACTIVE'
  AND cp."infographicSpec" IS NULL
  AND so."externalOfferId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
LIMIT 1;
SQL
)
echo "probe_listing=$LISTING"

python3 <<PY
import json, urllib.request, urllib.error
base = open("/tmp/rt_url").read().strip().replace("\r","").rstrip("/")
email = open("/tmp/rt_email").read().strip().replace("\r","")
password = open("/tmp/rt_pass").read().strip().replace("\r","")
listing = """$LISTING""".strip()
req = urllib.request.Request(
    f"{base}/auth/login",
    data=json.dumps({"email": email, "password": password}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as res:
    token = json.load(res)["accessToken"]
print("login ok")
for path in [
    f"/published-listings/trading-enrichment/budget",
    f"/published-listings/{listing}/trading-enrichment",
]:
    r = urllib.request.Request(f"{base}{path}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(r, timeout=120) as res:
            raw = res.read()
            print(f"OK {path} bytes={len(raw)}")
            if "budget" in path:
                print(raw[:400].decode())
    except urllib.error.HTTPError as e:
        print(f"ERR {path} {e.code} {e.read()[:200]}")
PY
