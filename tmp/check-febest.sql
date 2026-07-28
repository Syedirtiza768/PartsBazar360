SELECT id, name, "onboardingStatus" FROM "Seller" ORDER BY "createdAt" DESC LIMIT 40;
SELECT COUNT(*) AS total_parts FROM "CanonicalPart";
SELECT COUNT(*) AS febest_branded FROM "CanonicalPart" WHERE UPPER(COALESCE(brand,'')) LIKE '%FEBEST%';
SELECT COUNT(*) AS aftermarket FROM "CanonicalPart" WHERE "partType" = 'AFTERMARKET';
SELECT COUNT(*) AS upload_jobs FROM "SellerUploadJob";
SELECT id, "fileName", status, "insertedRows", "reviewRows", "defaultBrand", "createdAt"
FROM "SellerUploadJob" ORDER BY "createdAt" DESC LIMIT 15;
SELECT s.name, COUNT(o.id) AS offers
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
GROUP BY s.name
ORDER BY offers DESC
LIMIT 20;
SELECT "canonicalName", "displayName", "isAftermarketBrand"
FROM "BrandMaster"
WHERE "canonicalName" = 'FEBEST' OR "displayName" ILIKE '%FEBEST%';
