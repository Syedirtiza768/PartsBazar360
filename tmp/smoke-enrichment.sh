#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
PART_ID=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT cp.id FROM \"CanonicalPart\" cp JOIN \"SellerOffer\" so ON so.\"canonicalPartId\"=cp.id WHERE so.status='ACTIVE' AND COALESCE(cp.\"enrichmentVersion\",0) < 1 LIMIT 1;")
echo "part=$PART_ID"
curl -sL -X POST https://partsbazar360.com/api/search/enrichment/prewarm \
  -H 'Content-Type: application/json' \
  -d "{\"partIds\":[\"$PART_ID\"]}"
echo
sleep 2
curl -sL "https://partsbazar360.com/api/search/parts/$PART_ID/enrichment" | python3 -c \
  'import sys,json; d=json.load(sys.stdin); print("status", d.get("enrichmentStatus"), "ver", d.get("enrichmentVersion")); s=d.get("shipping") or {}; print("shipping", s.get("state"), s.get("source"), s.get("billableWeightKg"))'
echo "=== worker logs ==="
sudo docker compose logs --tail=40 worker 2>&1 | grep -iE 'enrich|Defer|OpenRouter|circuit' | tail -20 || true
echo DONE
