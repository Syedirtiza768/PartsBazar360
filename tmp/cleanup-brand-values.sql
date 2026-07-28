-- Data cleanup: NULL out brand values that are vehicle makes, not parts brands.
-- Brand = parts manufacturer (FEBEST, Bosch). Make = vehicle manufacturer (Toyota, BMW).
-- Many salvage listings incorrectly had vehicle makes stored as brand.

-- Step 1: Count affected rows
SELECT 'BEFORE' AS status,
  COUNT(*) AS total_parts,
  COUNT(*) FILTER (WHERE brand IS NOT NULL) AS with_brand,
  COUNT(*) FILTER (WHERE brand IS NULL) AS without_brand
FROM "CanonicalPart";

-- Step 2: NULL out vehicle-make brands (keep real parts brands like FEBEST)
UPDATE "CanonicalPart"
SET brand = NULL
WHERE brand IS NOT NULL
AND LOWER(brand) IN (
  'jaguar', 'audi', 'bmw', 'land rover', 'mercedes-benz', 'chevrolet',
  'volkswagen', 'kia', 'lexus', 'bentley', 'cadillac', 'ford', 'mini',
  'gmc', 'infiniti', 'porsche', 'toyota', 'mitsubishi', 'nissan',
  'rolls-royce', 'mazda', 'maserati', 'dodge', 'range rover', 'jeep',
  'hyundai', 'honda', 'fiat', 'buick', 'subaru', 'citroen', 'lamborghini',
  'volvo', 'seat', 'suzuki', 'renault', 'chrysler', 'acura', 'alfa romeo',
  'lincoln', 'skoda', 'scion', 'tesla', 'peugeot', 'saab', 'opel', 'ram',
  'aston martin', 'ferrari', 'smart', 'isuzu', 'mercedes', 'genesis',
  'mini cooper', 'volkwagen', 'landrover', 'vw', 'merc', 'alfa',
  'rolls royce', 'astonmartin'
);

-- Step 3: Show results
SELECT 'AFTER' AS status,
  COUNT(*) AS total_parts,
  COUNT(*) FILTER (WHERE brand IS NOT NULL) AS with_brand,
  COUNT(*) FILTER (WHERE brand IS NULL) AS without_brand
FROM "CanonicalPart";

-- Show remaining brands (should be real parts brands)
SELECT brand, COUNT(*) AS cnt
FROM "CanonicalPart"
WHERE brand IS NOT NULL
GROUP BY brand
ORDER BY cnt DESC
LIMIT 20;
