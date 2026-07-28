SELECT id, status, "totalRows", "processedRows", "insertedRows", "reviewRows", "invalidRows", "fileName", "defaultBrand"
FROM "SellerUploadJob"
ORDER BY "createdAt" DESC
LIMIT 5;

SELECT COUNT(*) AS febest_branded FROM "CanonicalPart" WHERE UPPER(COALESCE(brand,'')) LIKE '%FEBEST%';
SELECT COUNT(*) AS aftermarket FROM "CanonicalPart" WHERE "partType" = 'AFTERMARKET';
SELECT COUNT(*) AS febest_offers
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
WHERE s.name = 'FEBEST Inventory Supplier';
