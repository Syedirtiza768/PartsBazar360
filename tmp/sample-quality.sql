SELECT LEFT(p.title, 90) AS title, p."fitmentStatus", p."fitmentFlags",
       (SELECT COUNT(*) FROM "Fitment" f WHERE f."canonicalPartId"=p.id AND f."verificationStatus"='VERIFIED') AS verified_fitments,
       CASE WHEN p.compatibility IS NULL THEN 0 ELSE jsonb_array_length(p.compatibility::jsonb) END AS compat_rows
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId"=p.id AND o.status='ACTIVE'
JOIN "Seller" s ON s.id=o."sellerId"
WHERE s.name='Salvage Auto Parts'
ORDER BY o."updatedAt" DESC
LIMIT 8;

SELECT LEFT(p.title, 70) AS title, p."fitmentStatus",
       'MVL_VERIFIED'=ANY(p."fitmentFlags") AS mvl,
       'FEBEST_MVL_VERIFIED'=ANY(p."fitmentFlags") AS febest_mvl,
       CASE WHEN p.compatibility IS NULL THEN 0 ELSE jsonb_array_length(p.compatibility::jsonb) END AS compat_rows
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId"=p.id AND o.status='ACTIVE'
WHERE o."sellerId"='seller-superior-auto-parts'
  AND 'FEBEST_WEBSITE_DECLARED'=ANY(p."fitmentFlags")
ORDER BY p."updatedAt" DESC
LIMIT 5;
