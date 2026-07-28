SELECT s.name, COUNT(o.id) FILTER (WHERE o.status='ACTIVE') AS active_offers,
       COUNT(DISTINCT o."canonicalPartId") FILTER (WHERE o.status='ACTIVE') AS active_parts
FROM "Seller" s
LEFT JOIN "SellerOffer" o ON o."sellerId"=s.id
GROUP BY s.name
ORDER BY active_offers DESC NULLS LAST;

SELECT COUNT(*) AS parts_total FROM "CanonicalPart";
SELECT COUNT(*) AS fitments FROM "Fitment";
SELECT COUNT(*) AS parts_with_fitment FROM "CanonicalPart" p WHERE EXISTS (SELECT 1 FROM "Fitment" f WHERE f."canonicalPartId"=p.id);
SELECT COUNT(*) AS parts_with_compat_json FROM "CanonicalPart" WHERE compatibility IS NOT NULL AND compatibility::text NOT IN ('null','[]','{}');
SELECT COUNT(*) AS vehicle_configs FROM "VehicleConfiguration";
SELECT COUNT(*) AS vehicle_makes FROM "VehicleMake";
