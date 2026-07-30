#!/bin/bash
cd /home/ubuntu/PartsBazar360
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c "
SELECT
  \"sourceListingId\",
  LEFT(COALESCE(raw_payload_keys, ''), 500) AS keys_preview
FROM (
  SELECT
    \"sourceListingId\",
    (
      SELECT string_agg(k, ',' ORDER BY k)
      FROM jsonb_object_keys(\"rawPayload\") k
    ) AS raw_payload_keys
  FROM \"RawStagingListing\"
  ORDER BY \"updatedAt\" DESC
  LIMIT 3
) t;
"

echo '=== sample shippingDetails / listingPolicies from rawPayload ==='
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c "
SELECT json_build_object(
  'sourceListingId', \"sourceListingId\",
  'hasShippingDetails', (\"rawPayload\" ? 'shippingDetails'),
  'hasListingPolicies', (\"rawPayload\" ? 'listingPolicies'),
  'shippingDetails', \"rawPayload\"->'shippingDetails',
  'listingPolicies', \"rawPayload\"->'listingPolicies',
  'itemSpecificsWeight', (
    SELECT jsonb_agg(x)
    FROM jsonb_array_elements(COALESCE(\"rawPayload\"->'itemSpecifics','[]'::jsonb)) x
    WHERE lower(COALESCE(x->>'name', x->>'Name', '')) LIKE '%weight%'
       OR lower(COALESCE(x->>'name', x->>'Name', '')) LIKE '%shipping%'
  )
)
FROM \"RawStagingListing\"
ORDER BY \"updatedAt\" DESC
LIMIT 1;
"
