#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
PART=c29e7229-07a4-4ddb-88ee-bf67afe08dda
echo "=== enrichment endpoint ==="
curl -sL "https://partsbazar360.com/api/search/parts/$PART/enrichment" | python3 -m json.tool

echo "=== part payload summary ==="
curl -sL "https://partsbazar360.com/api/search/parts/$PART" -o /tmp/part.json
python3 <<'PY'
import json
d=json.load(open("/tmp/part.json"))
offers=d.get("offers") or []
print("title:", d.get("title"))
print("offers:", [(o.get("price"), o.get("currency") if "currency" in o else None, o.get("status")) for o in offers[:5]])
print("enrichmentStatus:", d.get("enrichmentStatus"), "version:", d.get("enrichmentVersion"), "source:", d.get("enrichmentSource"))
print("itemSpecifics:", d.get("itemSpecifics"))
print("infographicUrl:", d.get("infographicUrl"))
print("locationDiagramUrl:", d.get("locationDiagramUrl"))
print("imageUrls:", d.get("imageUrls"))
print("shipping:", d.get("shipping"))
print("position/material/vehicleSystem:", d.get("position"), d.get("material"), d.get("vehicleSystem"))
PY

echo "=== db ==="
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c "
SELECT \"enrichmentStatus\", \"enrichmentVersion\", \"enrichmentSource\",
       (\"itemSpecifics\" IS NOT NULL) AS has_specs,
       (\"infographicSpec\" IS NOT NULL) AS has_info,
       \"weightSource\", weight, \"billableWeightKg\"
FROM \"CanonicalPart\" WHERE id='$PART';
SELECT price, status FROM \"SellerOffer\" WHERE \"canonicalPartId\"='$PART';
SELECT \"mediaType\", url, \"sortOrder\" FROM \"ProductMedia\" WHERE \"canonicalPartId\"='$PART' ORDER BY \"sortOrder\";
"

echo "=== worker logs (recent) ==="
sudo docker compose logs --tail=100 worker | grep -iE "$PART|enrich|item.?spec|location|infographic|budget|defer" || true

echo "=== env gates ==="
sudo docker compose exec -T worker sh -c 'echo INFOGRAPHIC_MIN=$INFOGRAPHIC_MIN_PRICE_USD; echo LOCATION_MIN=$LOCATION_DIAGRAM_MIN_PRICE_USD; echo ENABLED=$ENRICHMENT_ENABLED'
