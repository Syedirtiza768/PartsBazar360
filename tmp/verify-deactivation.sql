SELECT p.title, p.brand, o.status, s.name
FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId"=p.id
JOIN "Seller" s ON s.id=o."sellerId"
WHERE p."ebayItemId" IN ('398121232563','398121232591','398121232630','398121232657','398121232707','398121232725','398121232797','398121232767')
ORDER BY p.title;

SELECT s.name,
  COUNT(*) FILTER (WHERE o.status='ACTIVE') AS active,
  COUNT(*) FILTER (WHERE o.status='INACTIVE') AS inactive
FROM "SellerOffer" o JOIN "Seller" s ON s.id=o."sellerId"
GROUP BY 1 ORDER BY 1;
