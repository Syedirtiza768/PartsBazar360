-- Who owns Superior / FEBEST catalog parts?
SELECT s.name, o."partSource", o."qualityTier", COUNT(*) 
FROM "SellerOffer" o
JOIN "Seller" s ON s.id=o."sellerId"
WHERE o.status='ACTIVE'
GROUP BY 1,2,3
ORDER BY 4 DESC
LIMIT 30;

SELECT brand, COUNT(*) FROM "CanonicalPart" p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id AND o.status='ACTIVE')
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

SELECT COUNT(*) AS active_without_fitment
FROM "CanonicalPart" p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id AND o.status='ACTIVE')
  AND NOT EXISTS (SELECT 1 FROM "Fitment" f WHERE f."canonicalPartId"=p.id);

SELECT COUNT(*) AS active_without_compat_json
FROM "CanonicalPart" p
WHERE EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id AND o.status='ACTIVE')
  AND (compatibility IS NULL OR compatibility::text IN ('null','[]','{}'));

SELECT LEFT(title, 80), brand, "manufacturerPartNumber"
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId"=p.id AND o.status='ACTIVE'
JOIN "Seller" s ON s.id=o."sellerId"
WHERE s.name ILIKE '%superior%' OR brand ILIKE '%febest%'
LIMIT 5;
