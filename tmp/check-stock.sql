SELECT s.name,
       COUNT(*) FILTER (WHERE COALESCE(inv.qty,0) > 0) AS with_stock,
       COUNT(*) FILTER (WHERE COALESCE(inv.qty,0) = 0) AS zero_stock
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
LEFT JOIN LATERAL (
  SELECT SUM(i.quantity) AS qty FROM "Inventory" i WHERE i."offerId" = o.id
) inv ON true
WHERE o.status = 'ACTIVE' AND s."onboardingStatus" = 'ACTIVE'
GROUP BY 1;
