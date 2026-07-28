#!/bin/bash
set -eu
PID=6f3f8d2a-5bf1-49e0-aede-7668a17bc826

echo "==== Part in DB ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT p.id, p.title, p.brand, p.\"manufacturerPartNumber\", p.\"partSource\", p.\"qualityTier\",
       p.\"listingUrl\", p.\"ebayItemId\", array_length(p.\"imageUrls\",1) AS img_count,
       p.compatibility IS NOT NULL AS has_compat,
       (SELECT string_agg(s.name||':'||o.status, ', ') FROM \"SellerOffer\" o JOIN \"Seller\" s ON s.id=o.\"sellerId\" WHERE o.\"canonicalPartId\"=p.id) AS offers
FROM \"CanonicalPart\" p WHERE p.id='$PID';
"

echo
echo "==== Part in OpenSearch? ===="
docker exec partsbazar360-api-1 sh -lc "curl -s \"http://opensearch:9200/canonical_parts/_doc/$PID\" | head -c 400"

echo
echo "==== Compatibility sample for this part ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT jsonb_array_length(p.compatibility) AS compat_rows, p.compatibility::text FROM \"CanonicalPart\" p WHERE p.id='$PID';
" | head -c 1500

echo
echo "==== Fitments for this part ===="
docker exec partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db -c "
SELECT f.\"evidenceLevel\", f.confidence, vc.id FROM \"Fitment\" f JOIN \"VehicleConfig\" vc ON vc.id=f.\"vehicleConfigId\" WHERE f.\"canonicalPartId\"='$PID' LIMIT 5;
"

echo
echo "==== Sitemap source (frontend) ===="
docker exec partsbazar360-api-1 sh -lc 'ls /app/apps/buyer-marketplace/app/sitemap.ts 2>/dev/null; wget -qO- http://127.0.0.1:3001/sitemap.xml 2>/dev/null | head -c 800 || true'
