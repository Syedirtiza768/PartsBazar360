UPDATE "SellerOffer" o
SET status = CASE
  WHEN EXISTS (
    SELECT 1 FROM "Inventory" i
    WHERE i."offerId" = o.id AND i.quantity > 0
  ) THEN 'ACTIVE'
  ELSE 'OUT_OF_STOCK'
END,
"updatedAt" = NOW()
WHERE o."sellerId" = 'seed-febest-inventory-supplier'
  AND o.status IN ('REVIEW', 'NEEDS_REVIEW');

SELECT status, COUNT(*) AS offers
FROM "SellerOffer"
WHERE "sellerId" = 'seed-febest-inventory-supplier'
GROUP BY status
ORDER BY offers DESC;

SELECT p."manufacturerPartNumber", p.title, o.status, o.price, o.currency
FROM "SellerOffer" o
JOIN "CanonicalPart" p ON p.id = o."canonicalPartId"
WHERE o."sellerId" = 'seed-febest-inventory-supplier'
  AND p."manufacturerPartNumber" = 'MZAB-124'
LIMIT 5;
