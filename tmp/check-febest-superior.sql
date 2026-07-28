SELECT id, name, "onboardingStatus"
FROM "Seller"
WHERE name ILIKE '%febest%'
   OR name ILIKE '%superior%'
   OR id LIKE '%febest%'
   OR id LIKE '%superior%';

SELECT s.id, s.name,
       COUNT(*) AS offers,
       COUNT(*) FILTER (WHERE o.status = 'ACTIVE') AS active
FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
JOIN "CanonicalPart" p ON p.id = o."canonicalPartId"
WHERE p.brand ILIKE '%FEBEST%'
GROUP BY 1, 2
ORDER BY offers DESC;

SELECT COUNT(*) AS febest_parts
FROM "CanonicalPart"
WHERE brand ILIKE '%FEBEST%';
