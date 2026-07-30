#!/bin/bash
cd /home/ubuntu/PartsBazar360
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -t -A -c "
SELECT jsonb_pretty(jsonb_build_object(
  'sourceListingId', to_jsonb(\"sourceListingId\"),
  'shippingDetailsType', to_jsonb(jsonb_typeof(\"rawPayload\"->'shippingDetails')),
  'shippingDetails', \"rawPayload\"->'shippingDetails',
  'listingPoliciesType', to_jsonb(jsonb_typeof(\"rawPayload\"->'listingPolicies')),
  'listingPolicies', \"rawPayload\"->'listingPolicies',
  'itemSpecificsType', to_jsonb(jsonb_typeof(\"rawPayload\"->'itemSpecifics')),
  'itemSpecifics', \"rawPayload\"->'itemSpecifics'
))
FROM \"RawStagingListing\"
ORDER BY \"updatedAt\" DESC
LIMIT 1;
"

echo '=== null/empty rates across sample of 200 ==='
sudo docker compose exec -T postgres psql -U partsbazar_user -d partsbazar_db -c "
WITH sample AS (
  SELECT \"rawPayload\"
  FROM \"RawStagingListing\"
  ORDER BY \"updatedAt\" DESC
  LIMIT 200
)
SELECT
  COUNT(*) AS n,
  COUNT(*) FILTER (WHERE \"rawPayload\"->'shippingDetails' IS NULL OR \"rawPayload\"->'shippingDetails' = 'null'::jsonb) AS shipping_null,
  COUNT(*) FILTER (WHERE jsonb_typeof(\"rawPayload\"->'shippingDetails') = 'object' AND \"rawPayload\"->'shippingDetails' <> '{}'::jsonb) AS shipping_nonempty_obj,
  COUNT(*) FILTER (WHERE jsonb_typeof(\"rawPayload\"->'shippingDetails') = 'array' AND jsonb_array_length(\"rawPayload\"->'shippingDetails') > 0) AS shipping_nonempty_arr,
  COUNT(*) FILTER (WHERE \"rawPayload\"->'listingPolicies' IS NULL OR \"rawPayload\"->'listingPolicies' = 'null'::jsonb) AS policies_null,
  COUNT(*) FILTER (WHERE jsonb_typeof(\"rawPayload\"->'listingPolicies') = 'object' AND \"rawPayload\"->'listingPolicies' <> '{}'::jsonb) AS policies_nonempty_obj
FROM sample;
"
