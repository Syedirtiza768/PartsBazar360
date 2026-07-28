#!/bin/sh
sleep 25
echo ----FEBEST----
docker exec partsbazar360-api-1 sh -lc 'tail -n 20 /tmp/febest-enrich-mvl.log'
echo ----BACKFILL----
docker exec partsbazar360-api-1 sh -lc 'tail -n 15 /tmp/backfill-compat-mvl.log'
echo ----ERRCOUNT----
docker exec partsbazar360-api-1 sh -lc 'grep -c "Unknown argument" /tmp/febest-enrich-mvl.log || echo 0; grep -c "\"status\":\"ok\"" /tmp/febest-enrich-mvl.log || echo 0'
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT COUNT(*) AS verified FROM "Fitment" WHERE "verificationStatus"='VERIFIED';
SELECT COUNT(*) AS active_mvl FROM "CanonicalPart" p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id AND o.status='ACTIVE')
  AND 'MVL_VERIFIED' = ANY("fitmentFlags");
SELECT LEFT(p.title,60), p."fitmentStatus",
  CASE WHEN p.compatibility IS NULL THEN 0 ELSE jsonb_array_length(p.compatibility::jsonb) END AS rows
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId"=p.id AND o.status='ACTIVE'
WHERE o."sellerId"='seller-superior-auto-parts' AND 'FEBEST_MVL_VERIFIED'=ANY(p."fitmentFlags")
ORDER BY p."updatedAt" DESC LIMIT 3;
SQL
