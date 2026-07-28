SELECT id, name FROM "Seller" WHERE name ILIKE '%febest%' OR name ILIKE '%superior%' OR id LIKE '%febest%' OR id LIKE '%superior%';
SELECT "sellerId", COUNT(*) FROM "SellerOffer" o JOIN "CanonicalPart" p ON p.id=o."canonicalPartId" WHERE p.brand ILIKE 'FEBEST' AND o.status='ACTIVE' GROUP BY 1;
