SELECT id, name, "storeId", status
FROM "Seller"
WHERE name ILIKE '%salvage%'
   OR name ILIKE '%blackline%'
   OR id LIKE 'seller-%'
ORDER BY name;
