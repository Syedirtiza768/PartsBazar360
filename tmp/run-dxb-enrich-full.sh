#!/bin/bash
# Full DXB OEM enrichment for all parts (PartSouq images + FEBEST DB compat copy).
# Live febest.de scrape is OFF by default (too slow). Set DXB_FEBEST=1 to enable.
set -eu
cd /home/ubuntu/PartsBazar360

LIMIT="${DXB_LIMIT:-all}"
FORCE="${DXB_FORCE:-0}"
DELAY_MS="${DXB_DELAY_MS:-50}"
FEBEST="${DXB_FEBEST:-0}"

if [ ! -x /tmp/oem-venv/bin/python ]; then
  python3 -m venv /tmp/oem-venv
fi
/tmp/oem-venv/bin/pip install -q 'psycopg[binary]' >/dev/null

DBURL=$(sudo docker exec partsbazar360-api-1 printenv DATABASE_URL)
PG_IP=$(sudo docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' partsbazar360-postgres-1)
OS_IP=$(sudo docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' partsbazar360-opensearch-1)
HOST_DBURL=$(echo "$DBURL" | sed "s/@postgres:/@${PG_IP}:/")

export DATABASE_URL="$HOST_DBURL"
export OPENSEARCH_URL="http://${OS_IP}:9200"
export DXB_FORCE="$FORCE"
export DXB_DELAY_MS="$DELAY_MS"
export DXB_FEBEST="$FEBEST"
export DXB_STATE_PATH="${DXB_STATE_PATH:-/tmp/dxb-oem-enrich-progress.json}"

if [ "$LIMIT" = "all" ] || [ "$LIMIT" = "0" ]; then
  unset DXB_LIMIT || true
else
  export DXB_LIMIT="$LIMIT"
fi

echo "Running DXB OEM enrich limit=${DXB_LIMIT:-all} force=$FORCE delayMs=$DELAY_MS febestLive=$FEBEST"
/tmp/oem-venv/bin/python apps/api/scripts/enrich-dxb-from-partsouq.py
