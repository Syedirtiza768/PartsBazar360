#!/bin/bash
# Wait until RealTrack stops returning 429, then resume throttled SVG batch.
set -euo pipefail
cd /home/ubuntu/PartsBazar360

printf '%s\n' 'https://mhn.realtrackapp.com/api' > /tmp/svg_rt_url
printf '%s\n' 'api-published-listings@realtrack.local' > /tmp/svg_rt_email
printf '%s\n' 'Ebay$321' > /tmp/svg_rt_pass

# Override from api env if present and absolute
if [ -n "$(sudo docker compose ps -q api 2>/dev/null || true)" ]; then
  URL=$(sudo docker compose exec -T api printenv REALTRACK_API_URL 2>/dev/null | tr -d '\r' || true)
  EMAIL=$(sudo docker compose exec -T api printenv REALTRACK_API_EMAIL 2>/dev/null | tr -d '\r' || true)
  PASS=$(sudo docker compose exec -T api printenv REALTRACK_API_PASSWORD 2>/dev/null | tr -d '\r' || true)
  case "$URL" in
    http://*|https://*) printf '%s\n' "$URL" > /tmp/svg_rt_url ;;
  esac
  [ -n "${EMAIL:-}" ] && printf '%s\n' "$EMAIL" > /tmp/svg_rt_email
  [ -n "${PASS:-}" ] && printf '%s\n' "$PASS" > /tmp/svg_rt_pass
fi

echo "RT base=$(cat /tmp/svg_rt_url)"

probe() {
python3 <<'PY'
import json, urllib.request, urllib.error, sys
base = open("/tmp/svg_rt_url").read().strip().replace("\r","").rstrip("/")
email = open("/tmp/svg_rt_email").read().strip().replace("\r","")
password = open("/tmp/svg_rt_pass").read().strip().replace("\r","")
if not base.startswith("http"):
    print("ERR bad base", repr(base))
    sys.exit(1)
req = urllib.request.Request(
    f"{base}/auth/login",
    data=json.dumps({"email": email, "password": password}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as res:
    token = json.load(res)["accessToken"]
r = urllib.request.Request(
    f"{base}/published-listings/trading-enrichment/budget",
    headers={"Authorization": f"Bearer {token}"},
)
try:
    with urllib.request.urlopen(r, timeout=30) as res:
        body = json.load(res)
        print("OK", json.dumps(body))
        sys.exit(0)
except urllib.error.HTTPError as e:
    print("ERR", e.code, e.read()[:160].decode("utf-8", "ignore"))
    sys.exit(1)
PY
}

echo "Waiting for RealTrack throttle to clear (1000/hr limit)..."
for i in $(seq 1 36); do
  echo "probe attempt $i at $(date -u +%H:%M:%SZ)"
  if probe; then
    echo "RT healthy — starting throttle"
    break
  fi
  if [ "$i" -eq 36 ]; then
    echo "gave up after 3 hours"
    exit 1
  fi
  sleep 300
done

sed -i 's/^ENRICHMENT_CONCURRENCY=.*/ENRICHMENT_CONCURRENCY=1/' /home/ubuntu/PartsBazar360/.env || true
grep -q '^ENRICHMENT_CONCURRENCY=' .env || echo 'ENRICHMENT_CONCURRENCY=1' >> .env
sudo docker compose up -d worker
sleep 8
sudo docker compose exec -T worker sh -c 'echo CONC=$ENRICHMENT_CONCURRENCY DIAG=$LOCATION_DIAGRAM_MIN_PRICE_USD'

CID=$(sudo docker compose ps -q api)
sudo docker cp /tmp/throttle-svg-batch.cjs "$CID":/app/throttle-svg-batch.cjs
sudo pkill -f 'throttle-svg-batch.cjs' 2>/dev/null || true
sleep 1

LOG=/home/ubuntu/svg-throttle.log
: > "$LOG"

nohup sudo docker compose exec -T \
  -e SVG_WAVE_SIZE=12 \
  -e SVG_WAVE_RESUME_BELOW=0 \
  -e SVG_WAVE_PAUSE_MS=45000 \
  -e SVG_BATCH_PRIORITY=20 \
  -e SVG_BATCH_STATE=/tmp/svg-throttle-state.json \
  -e POSTGRES_HOST=postgres \
  -e POSTGRES_USER=partsbazar_user \
  -e POSTGRES_PASSWORD=partsbazar_password \
  -e POSTGRES_DB=partsbazar_db \
  -e REDIS_HOST=redis \
  api node /app/throttle-svg-batch.cjs \
  > "$LOG" 2>&1 &

echo "throttle_pid=$!"
sleep 8
tail -n 30 "$LOG"
