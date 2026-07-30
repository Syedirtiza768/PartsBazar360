#!/bin/bash
# Deploy Tamara checkout + enrichment budget cache to production Docker.
set -euo pipefail
cd /home/ubuntu/PartsBazar360

echo "=== git sync ==="
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e tmp -e certbot
echo "HEAD=$(git rev-parse --short HEAD)"
echo "MSG=$(git log -1 --pretty=%s)"

if [ ! -f .env ]; then
  echo "ERROR: .env missing"
  exit 1
fi

echo "=== ensure Tamara sandbox env keys exist ==="
# Values are merged from /tmp/tamara.env.secrets if present (mode 600).
if [ -f /tmp/tamara.env.secrets ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    key="${line%%=*}"
    if grep -qE "^${key}=" .env; then
      # Escape sed replacement carefully for secret values.
      val="${line#*=}"
      python3 - "$key" "$val" <<'PY'
import pathlib, re, sys
key, val = sys.argv[1], sys.argv[2]
path = pathlib.Path(".env")
text = path.read_text()
pat = re.compile(rf"^{re.escape(key)}=.*$", re.M)
if pat.search(text):
    text = pat.sub(f"{key}={val}", text, count=1)
else:
    text = text.rstrip("\n") + f"\n{key}={val}\n"
path.write_text(text)
PY
    else
      printf '%s\n' "$line" >> .env
    fi
  done < /tmp/tamara.env.secrets
  shred -u /tmp/tamara.env.secrets 2>/dev/null || rm -f /tmp/tamara.env.secrets
fi

# Defaults if keys still missing (empty until secrets file applied).
grep -qE '^TAMARA_API_URL=' .env || echo 'TAMARA_API_URL=https://api-sandbox.tamara.co' >> .env
grep -qE '^TAMARA_API_TOKEN=' .env || echo 'TAMARA_API_TOKEN=' >> .env
grep -qE '^TAMARA_NOTIFICATION_TOKEN=' .env || echo 'TAMARA_NOTIFICATION_TOKEN=' >> .env
grep -qE '^TAMARA_PUBLIC_KEY=' .env || echo 'TAMARA_PUBLIC_KEY=' >> .env

echo "=== Tamara env presence (no values) ==="
python3 - <<'PY'
from pathlib import Path
keys = [
  "TAMARA_API_URL",
  "TAMARA_API_TOKEN",
  "TAMARA_NOTIFICATION_TOKEN",
  "TAMARA_PUBLIC_KEY",
]
text = Path(".env").read_text()
for k in keys:
    for line in text.splitlines():
        if line.startswith(k + "="):
            val = line.split("=", 1)[1]
            print(f"{k}=set({len(val)} chars)" if val else f"{k}=EMPTY")
            break
    else:
        print(f"{k}=MISSING")
PY

echo "=== rebuild api + worker + buyer-marketplace ==="
sudo docker compose build api worker buyer-marketplace
sudo docker compose up -d api worker buyer-marketplace

echo "=== wait for api healthy ==="
for i in $(seq 1 60); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' "$(sudo docker compose ps -q api)" 2>/dev/null || echo starting)
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

echo "=== smoke ==="
curl -sf https://partsbazar360.com/api/health || curl -sf https://partsbazar360.realtrackapp.com/api/health
echo
curl -sL -o /dev/null -w "buyer=%{http_code}\n" https://partsbazar360.com/buyer/
curl -sL -o /dev/null -w "checkout=%{http_code}\n" https://partsbazar360.com/buyer/checkout/

echo "=== DONE ==="
echo "Register Tamara webhook URL (Partners Portal):"
echo "  https://partsbazar360.com/api/checkout/webhooks/tamara"
