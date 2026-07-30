#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
echo "=== AI-enriched sample payloads ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c \
  "SELECT left(title,40) AS title, \"weightSource\", \"enrichmentSource\", \"enrichmentVersion\",
          left(COALESCE(\"itemSpecifics\"::text,'null'), 500) AS item_specifics_preview
   FROM \"CanonicalPart\"
   WHERE \"weightSource\"='AI'
   ORDER BY \"enrichedAt\" DESC NULLS LAST
   LIMIT 3;"
echo "=== itemSpecifics presence among AI-weight parts ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c \
  "SELECT count(*) FILTER (WHERE \"itemSpecifics\" IS NOT NULL) AS has_specs,
          count(*) FILTER (WHERE \"itemSpecifics\" IS NULL) AS no_specs,
          count(*) AS total
   FROM \"CanonicalPart\" WHERE \"weightSource\"='AI';"
echo "=== live PDP itemSpecifics for one AI part ==="
PART=$(sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c \
  "SELECT id FROM \"CanonicalPart\" WHERE \"weightSource\"='AI' ORDER BY \"enrichedAt\" DESC NULLS LAST LIMIT 1;")
echo "part=$PART"
curl -sL "https://partsbazar360.com/api/search/parts/$PART" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("title:", d.get("title"))
print("shipping:", {k:(d.get("shipping") or {}).get(k) for k in ("state","source","weightKg","billableWeightKg")})
print("itemSpecifics:", json.dumps(d.get("itemSpecifics"), indent=2)[:1200])
print("position/material/vehicleSystem:", d.get("position"), d.get("material"), d.get("vehicleSystem"))
print("infographicUrl:", d.get("infographicUrl"))
'
