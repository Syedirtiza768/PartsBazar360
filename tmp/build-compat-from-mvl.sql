-- Build compatibility rows from MVL database for parts that don't have them.
-- Strategy: extract year+make+model from part title, match against MVL.

-- Step 1: Create a temp table with parsed title data
CREATE TEMP TABLE parsed_parts AS
SELECT 
  cp.id,
  cp.title,
  -- Extract year range from title
  CASE 
    WHEN cp.title ~ '\d{4}\s*[-–]\s*\d{4}' THEN 
      (regexp_match(cp.title, '(\d{4})\s*[-–]\s*(\d{4})'))[1]::int
    WHEN cp.title ~ '\d{4}' THEN
      (regexp_match(cp.title, '(\d{4})'))[1]::int
    ELSE NULL
  END AS start_year,
  CASE 
    WHEN cp.title ~ '\d{4}\s*[-–]\s*\d{4}' THEN 
      (regexp_match(cp.title, '\d{4}\s*[-–]\s*(\d{4})'))[1]::int
    WHEN cp.title ~ '\d{4}' THEN
      (regexp_match(cp.title, '(\d{4})'))[1]::int
    ELSE NULL
  END AS end_year,
  -- Extract make from title (match against known makes)
  CASE
    WHEN cp.title ~* '\b(acura)\b' THEN 'ACURA'
    WHEN cp.title ~* '\b(audi)\b' THEN 'AUDI'
    WHEN cp.title ~* '\b(bmw)\b' THEN 'BMW'
    WHEN cp.title ~* '\b(bentley)\b' THEN 'BENTLEY'
    WHEN cp.title ~* '\b(buick)\b' THEN 'BUICK'
    WHEN cp.title ~* '\b(cadillac)\b' THEN 'CADILLAC'
    WHEN cp.title ~* '\b(chevrolet|chevy)\b' THEN 'CHEVROLET'
    WHEN cp.title ~* '\b(chrysler)\b' THEN 'CHRYSLER'
    WHEN cp.title ~* '\b(dodge)\b' THEN 'DODGE'
    WHEN cp.title ~* '\b(fiat)\b' THEN 'FIAT'
    WHEN cp.title ~* '\b(ford)\b' THEN 'FORD'
    WHEN cp.title ~* '\b(gmc)\b' THEN 'GMC'
    WHEN cp.title ~* '\b(honda)\b' THEN 'HONDA'
    WHEN cp.title ~* '\b(hyundai)\b' THEN 'HYUNDAI'
    WHEN cp.title ~* '\b(infiniti)\b' THEN 'INFINITI'
    WHEN cp.title ~* '\b(jaguar)\b' THEN 'JAGUAR'
    WHEN cp.title ~* '\b(jeep)\b' THEN 'JEEP'
    WHEN cp.title ~* '\b(kia)\b' THEN 'KIA'
    WHEN cp.title ~* '\b(land\s*rover)\b' THEN 'LANDROVER'
    WHEN cp.title ~* '\b(lexus)\b' THEN 'LEXUS'
    WHEN cp.title ~* '\b(lincoln)\b' THEN 'LINCOLN'
    WHEN cp.title ~* '\b(maserati)\b' THEN 'MASERATI'
    WHEN cp.title ~* '\b(mazda)\b' THEN 'MAZDA'
    WHEN cp.title ~* '\b(mercedes[\s-]*benz|mercedes)\b' THEN 'MERCEDESBENZ'
    WHEN cp.title ~* '\b(mini)\b' THEN 'MINI'
    WHEN cp.title ~* '\b(mitsubishi)\b' THEN 'MITSUBISHI'
    WHEN cp.title ~* '\b(nissan)\b' THEN 'NISSAN'
    WHEN cp.title ~* '\b(opel)\b' THEN 'OPEL'
    WHEN cp.title ~* '\b(peugeot)\b' THEN 'PEUGEOT'
    WHEN cp.title ~* '\b(pontiac)\b' THEN 'PONTIAC'
    WHEN cp.title ~* '\b(porsche)\b' THEN 'PORSCHE'
    WHEN cp.title ~* '\b(ram)\b' THEN 'RAM'
    WHEN cp.title ~* '\b(renault)\b' THEN 'RENAULT'
    WHEN cp.title ~* '\b(rolls[\s-]*royce)\b' THEN 'ROLLSROYCE'
    WHEN cp.title ~* '\b(saab)\b' THEN 'SAAB'
    WHEN cp.title ~* '\b(saturn)\b' THEN 'SATURN'
    WHEN cp.title ~* '\b(scion)\b' THEN 'SCION'
    WHEN cp.title ~* '\b(subaru)\b' THEN 'SUBARU'
    WHEN cp.title ~* '\b(suzuki)\b' THEN 'SUZUKI'
    WHEN cp.title ~* '\b(tesla)\b' THEN 'TESLA'
    WHEN cp.title ~* '\b(toyota)\b' THEN 'TOYOTA'
    WHEN cp.title ~* '\b(volvo)\b' THEN 'VOLVO'
    WHEN cp.title ~* '\b(volkswagen|vw)\b' THEN 'VOLKSWAGEN'
    WHEN cp.title ~* '\b(citroen)\b' THEN 'CITROEN'
    WHEN cp.title ~* '\b(alfa\s*romeo)\b' THEN 'ALFAROMEO'
    WHEN cp.title ~* '\b(ferrari)\b' THEN 'FERRARI'
    WHEN cp.title ~* '\b(lamborghini)\b' THEN 'LAMBORGHINI'
    WHEN cp.title ~* '\b(rolls)\b' THEN 'ROLLSROYCE'
    WHEN cp.title ~* '\b(range\s*rover)\b' THEN 'RANGEROVER'
    WHEN cp.title ~* '\b(freightliner)\b' THEN 'FREIGHTLINER'
    WHEN cp.title ~* '\b(peterbilt)\b' THEN 'PETERBILT'
    WHEN cp.title ~* '\b(kenworth)\b' THEN 'KENWORTH'
    WHEN cp.title ~* '\b(isuzu)\b' THEN 'ISUZU'
    WHEN cp.title ~* '\b(genesis)\b' THEN 'GENESIS'
    WHEN cp.title ~* '\b(cupra)\b' THEN 'CUPRA'
    WHEN cp.title ~* '\b(skoda)\b' THEN 'SKODA'
    WHEN cp.title ~* '\b(seat)\b' THEN 'SEAT'
    WHEN cp.title ~* '\b(ds)\b' THEN 'DS'
    WHEN cp.title ~* '\b(smart)\b' THEN 'SMART'
    WHEN cp.title ~* '\b(changan)\b' THEN 'CHANGAN'
    WHEN cp.title ~* '\b(geely)\b' THEN 'GEELY'
    WHEN cp.title ~* '\b(great\s*wall)\b' THEN 'GREATWALL'
    WHEN cp.title ~* '\b(byd)\b' THEN 'BYD'
    WHEN cp.title ~* '\b(chery)\b' THEN 'CHERY'
    WHEN cp.title ~* '\b(proton)\b' THEN 'PROTON'
    WHEN cp.title ~* '\b(perodua)\b' THEN 'PERODUA'
    WHEN cp.title ~* '\b(tata)\b' THEN 'TATA'
    WHEN cp.title ~* '\b(mahindra)\b' THEN 'MAHINDRA'
    WHEN cp.title ~* '\b(ashok\s*leyland)\b' THEN 'ASHOKLEYLAND'
    ELSE NULL
  END AS parsed_make
FROM "CanonicalPart" cp
WHERE cp.compatibility IS NULL 
   OR cp.compatibility::text IN ('null', '[]', '');

-- Step 2: Count what we can match
SELECT 
  COUNT(*) AS total_parts,
  COUNT(*) FILTER (WHERE parsed_make IS NOT NULL AND start_year IS NOT NULL) AS can_match,
  COUNT(*) FILTER (WHERE parsed_make IS NULL) AS no_make,
  COUNT(*) FILTER (WHERE start_year IS NULL) AS no_year
FROM parsed_parts;

-- Step 3: Build compatibility from MVL and update parts
-- This matches year+make against MVL to get full vehicle details
WITH compat_matches AS (
  SELECT 
    pp.id AS part_id,
    jsonb_agg(DISTINCT jsonb_build_object(
      'year', mv.year,
      'make', mv.make,
      'model', mv.model,
      'trim', COALESCE(mv.trim, ''),
      'engine', COALESCE(mv.engine, ''),
      'driveType', COALESCE(mv."driveType", ''),
      'fuelType', COALESCE(mv."fuelType", ''),
      'body', COALESCE(mv.body, '')
    )) AS compat_rows
  FROM parsed_parts pp
  JOIN "MvlVehicle" mv ON (
    mv."normalizedMake" = pp.parsed_make
    AND mv.year BETWEEN pp.start_year AND pp.end_year
    AND mv.market = 'US'
  )
  WHERE pp.parsed_make IS NOT NULL 
    AND pp.start_year IS NOT NULL
  GROUP BY pp.id
  HAVING COUNT(*) <= 300  -- skip parts with too many matches (bad parse)
)
UPDATE "CanonicalPart" cp
SET compatibility = cm.compat_rows
FROM compat_matches cm
WHERE cp.id = cm.part_id;

-- Step 4: Report results
SELECT 
  COUNT(*) AS total_parts,
  COUNT(*) FILTER (WHERE compatibility IS NOT NULL AND compatibility::text NOT IN ('null', '[]')) AS with_compat
FROM "CanonicalPart";
