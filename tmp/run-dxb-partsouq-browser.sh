#!/bin/bash
# Browser-backed PartSouq enrich for DXB (via FlareSolverr).
# Usage:
#   DXB_LIMIT=20 bash tmp/run-dxb-partsouq-browser.sh
#   DXB_LIMIT=all bash tmp/run-dxb-partsouq-browser.sh
set -eu
cd /home/ubuntu/PartsBazar360

LIMIT="${DXB_LIMIT:-20}"
FORCE="${DXB_FORCE:-0}"
DELAY_MS="${DXB_DELAY_MS:-800}"
ONLY_MISSING="${DXB_ONLY_MISSING:-1}"

# Ensure FlareSolverr
if ! sudo docker ps --format '{{.Names}}' | grep -q '^flaresolverr$'; then
  sudo docker rm -f flaresolverr 2>/dev/null || true
  sudo docker run -d --name flaresolverr -p 8191:8191 --restart unless-stopped ghcr.io/flaresolverr/flaresolverr:latest
fi
for i in $(seq 1 30); do
  if curl -sS http://127.0.0.1:8191/health 2>/dev/null | grep -q ok; then break; fi
  sleep 2
done

if [ ! -x /tmp/oem-venv/bin/python ]; then
  python3 -m venv /tmp/oem-venv
fi
/tmp/oem-venv/bin/pip install -q beautifulsoup4 lxml 'psycopg[binary]' >/dev/null

DBURL=$(sudo docker exec partsbazar360-api-1 printenv DATABASE_URL)
PG_IP=$(sudo docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' partsbazar360-postgres-1)
OS_IP=$(sudo docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' partsbazar360-opensearch-1)
export DATABASE_URL=$(echo "$DBURL" | sed "s/@postgres:/@${PG_IP}:/")
export OPENSEARCH_URL="http://${OS_IP}:9200"
export DXB_FORCE="$FORCE"
export DXB_DELAY_MS="$DELAY_MS"
export DXB_ONLY_MISSING="$ONLY_MISSING"
export DXB_STATE_PATH="${DXB_STATE_PATH:-/tmp/dxb-partsouq-browser-progress.json}"
export FLARESOLVERR_URL="http://127.0.0.1:8191/v1"

if [ "$LIMIT" = "all" ] || [ "$LIMIT" = "0" ]; then
  unset DXB_LIMIT || true
else
  export DXB_LIMIT="$LIMIT"
fi

echo "Running PartSouq browser enrich limit=${DXB_LIMIT:-all} force=$FORCE onlyMissing=$ONLY_MISSING"
/tmp/oem-venv/bin/python apps/api/scripts/enrich-dxb-partsouq-browser.py
