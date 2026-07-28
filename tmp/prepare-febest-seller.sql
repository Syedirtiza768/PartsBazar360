-- Ensure spreadsheet org + FEBEST seller + warehouses exist
INSERT INTO "Organization" (id, name, "createdAt", "updatedAt")
VALUES ('seed-spreadsheet-suppliers', 'Spreadsheet Inventory Suppliers', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "updatedAt" = NOW();

INSERT INTO "Seller" (id, "organizationId", name, "onboardingStatus", "activatedAt", "createdAt", "updatedAt")
SELECT 'seed-febest-inventory-supplier', 'seed-spreadsheet-suppliers', 'FEBEST Inventory Supplier', 'ACTIVE', NOW(), NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Seller" WHERE name = 'FEBEST Inventory Supplier'
);

UPDATE "Seller"
SET "onboardingStatus" = 'ACTIVE', "activatedAt" = COALESCE("activatedAt", NOW()), "updatedAt" = NOW()
WHERE name = 'FEBEST Inventory Supplier';

INSERT INTO "SellerSourceAccount" (id, "sellerId", "sourcePlatform", "externalAccountId", "lastSyncedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'SPREADSHEET', 'SEED_FEBEST_FILE', NOW(), NOW(), NOW()
FROM "Seller" s
WHERE s.name = 'FEBEST Inventory Supplier'
  AND NOT EXISTS (
    SELECT 1 FROM "SellerSourceAccount" a
    WHERE a."sellerId" = s.id AND a."sourcePlatform" = 'SPREADSHEET' AND a."externalAccountId" = 'SEED_FEBEST_FILE'
  );

INSERT INTO "Warehouse" (id, "sellerId", "externalKey", name, location, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'DEFAULT', 'FEBEST Inventory Supplier Main Warehouse', 'UAE', NOW(), NOW()
FROM "Seller" s
WHERE s.name = 'FEBEST Inventory Supplier'
  AND NOT EXISTS (
    SELECT 1 FROM "Warehouse" w WHERE w."sellerId" = s.id AND w."externalKey" = 'DEFAULT'
  );

INSERT INTO "Warehouse" (id, "sellerId", "externalKey", name, location, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'SHARJAH', 'Sharjah', 'Sharjah, UAE', NOW(), NOW()
FROM "Seller" s
WHERE s.name = 'FEBEST Inventory Supplier'
  AND NOT EXISTS (
    SELECT 1 FROM "Warehouse" w WHERE w."sellerId" = s.id AND w."externalKey" = 'SHARJAH'
  );

INSERT INTO "Warehouse" (id, "sellerId", "externalKey", name, location, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, 'JEBEL_ALI', 'Jebel Ali', 'Jebel Ali, UAE', NOW(), NOW()
FROM "Seller" s
WHERE s.name = 'FEBEST Inventory Supplier'
  AND NOT EXISTS (
    SELECT 1 FROM "Warehouse" w WHERE w."sellerId" = s.id AND w."externalKey" = 'JEBEL_ALI'
  );

SELECT id, name, "onboardingStatus" FROM "Seller" WHERE name = 'FEBEST Inventory Supplier';
