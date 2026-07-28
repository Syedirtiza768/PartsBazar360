SELECT p.title, p.brand, p."ebayItemId", r."storeId", r.title AS raw_title, r.status
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId"=p.id JOIN "Seller" s ON s.id=o."sellerId"
LEFT JOIN "RawStagingListing" r ON r."ebayItemId"=p."ebayItemId"
WHERE s.name='Salvage Auto Parts' AND o.status='ACTIVE'
ORDER BY p."createdAt" DESC LIMIT 12;

SELECT r."storeId", COUNT(DISTINCT p.id) AS parts
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId"=p.id JOIN "Seller" s ON s.id=o."sellerId"
LEFT JOIN "RawStagingListing" r ON r."ebayItemId"=p."ebayItemId"
WHERE s.name='Salvage Auto Parts' AND o.status='ACTIVE'
GROUP BY 1 ORDER BY 2 DESC;

SELECT s.name,
  COUNT(*) FILTER (WHERE o.price IS NULL) AS no_price,
  COUNT(*) FILTER (WHERE o.currency IS NULL OR o.currency='') AS no_currency,
  COUNT(*) FILTER (WHERE o.condition IS NULL OR o.condition='') AS no_condition
FROM "SellerOffer" o JOIN "Seller" s ON s.id=o."sellerId"
WHERE o.status='ACTIVE' AND s."onboardingStatus"='ACTIVE'
GROUP BY 1;

SELECT COUNT(*) AS parts_with_zero_offers,
       COUNT(*) FILTER (WHERE p."ebayItemId" IS NOT NULL) AS with_ebay,
       COUNT(*) FILTER (WHERE p.brand ILIKE '%febest%') AS febest_branded
FROM "CanonicalPart" p
WHERE NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id);
