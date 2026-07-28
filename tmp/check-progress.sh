#!/bin/sh
set -eu
sleep 20
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT s.name, COUNT(*) FILTER (WHERE o.status='ACTIVE') AS active
FROM "Seller" s
LEFT JOIN "SellerOffer" o ON o."sellerId"=s.id
WHERE s.name IN ('Salvage Auto Parts','Superior Auto Parts','Blackline Auto Parts')
GROUP BY 1;

SELECT COUNT(*) AS mvl_verified_fitments
FROM "Fitment"
WHERE "verificationStatus"='VERIFIED' OR reviewer ILIKE '%MVL%';

SELECT COUNT(*) AS active_with_compat
FROM "CanonicalPart" p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id AND o.status='ACTIVE')
  AND compatibility IS NOT NULL
  AND compatibility::text NOT IN ('null','[]','{}');

SELECT COUNT(*) AS active_mvl_flag
FROM "CanonicalPart" p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id AND o.status='ACTIVE')
  AND 'MVL_VERIFIED' = ANY("fitmentFlags");
SQL

echo ----SALVAGEA----
docker exec partsbazar360-api-1 sh -lc 'tail -n 25 /tmp/seed-salvagea.log'
echo ----FEBEST----
docker exec partsbazar360-api-1 sh -lc 'tail -n 25 /tmp/febest-enrich-mvl.log'
echo ----PROCS----
docker exec partsbazar360-api-1 sh -lc 'ps aux | grep -E "seed-salvagea|enrich-febest" | grep -v grep || true'
