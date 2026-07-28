-- Build compatibility rows from MVL - optimized single-pass approach
-- Runs the UPDATE directly without temp table

WITH parsed AS (
  SELECT 
    cp.id,
    CASE 
      WHEN cp.title ~ '\d{4}\s*[-–]\s*\d{4}' THEN (regexp_match(cp.title, '(\d{4})\s*[-–]\s*(\d{4})'))[1]::int
      WHEN cp.title ~ '\d{4}' THEN (regexp_match(cp.title, '(\d{4})'))[1]::int
    END AS yr,
    CASE 
      WHEN cp.title ~ '\d{4}\s*[-–]\s*\d{4}' THEN (regexp_match(cp.title, '\d{4}\s*[-–]\s*(\d{4})'))[1]::int
      WHEN cp.title ~ '\d{4}' THEN (regexp_match(cp.title, '(\d{4})'))[1]::int
    END AS yr2,
    CASE
      WHEN cp.title ~* '\b(bmw)\b' THEN 'BMW'
      WHEN cp.title ~* '\b(audi)\b' THEN 'AUDI'
      WHEN cp.title ~* '\b(jaguar)\b' THEN 'JAGUAR'
      WHEN cp.title ~* '\b(lexus)\b' THEN 'LEXUS'
      WHEN cp.title ~* '\b(mercedes[\s-]*benz|mercedes)\b' THEN 'MERCEDESBENZ'
      WHEN cp.title ~* '\b(ford)\b' THEN 'FORD'
      WHEN cp.title ~* '\b(chevrolet|chevy)\b' THEN 'CHEVROLET'
      WHEN cp.title ~* '\b(toyota)\b' THEN 'TOYOTA'
      WHEN cp.title ~* '\b(nissan)\b' THEN 'NISSAN'
      WHEN cp.title ~* '\b(honda)\b' THEN 'HONDA'
      WHEN cp.title ~* '\b(dodge)\b' THEN 'DODGE'
      WHEN cp.title ~* '\b(volkswagen|vw)\b' THEN 'VOLKSWAGEN'
      WHEN cp.title ~* '\b(mazda)\b' THEN 'MAZDA'
      WHEN cp.title ~* '\b(cadillac)\b' THEN 'CADILLAC'
      WHEN cp.title ~* '\b(porsche)\b' THEN 'PORSCHE'
      WHEN cp.title ~* '\b(lincoln)\b' THEN 'LINCOLN'
      WHEN cp.title ~* '\b(gmc)\b' THEN 'GMC'
      WHEN cp.title ~* '\b(buick)\b' THEN 'BUICK'
      WHEN cp.title ~* '\b(chrysler)\b' THEN 'CHRYSLER'
      WHEN cp.title ~* '\b(jeep)\b' THEN 'JEEP'
      WHEN cp.title ~* '\b(kia)\b' THEN 'KIA'
      WHEN cp.title ~* '\b(hyundai)\b' THEN 'HYUNDAI'
      WHEN cp.title ~* '\b(infiniti)\b' THEN 'INFINITI'
      WHEN cp.title ~* '\b(acura)\b' THEN 'ACURA'
      WHEN cp.title ~* '\b(subaru)\b' THEN 'SUBARU'
      WHEN cp.title ~* '\b(mitsubishi)\b' THEN 'MITSUBISHI'
      WHEN cp.title ~* '\b(volvo)\b' THEN 'VOLVO'
      WHEN cp.title ~* '\b(land\s*rover)\b' THEN 'LANDROVER'
      WHEN cp.title ~* '\b(range\s*rover)\b' THEN 'RANGEROVER'
      WHEN cp.title ~* '\b(mini)\b' THEN 'MINI'
      WHEN cp.title ~* '\b(maserati)\b' THEN 'MASERATI'
      WHEN cp.title ~* '\b(bentley)\b' THEN 'BENTLEY'
      WHEN cp.title ~* '\b(rolls[\s-]*royce)\b' THEN 'ROLLSROYCE'
      WHEN cp.title ~* '\b(ram)\b' THEN 'RAM'
      WHEN cp.title ~* '\b(fiat)\b' THEN 'FIAT'
      WHEN cp.title ~* '\b(saab)\b' THEN 'SAAB'
      WHEN cp.title ~* '\b(pontiac)\b' THEN 'PONTIAC'
      WHEN cp.title ~* '\b(saturn)\b' THEN 'SATURN'
      WHEN cp.title ~* '\b(scion)\b' THEN 'SCION'
      WHEN cp.title ~* '\b(suzuki)\b' THEN 'SUZUKI'
      WHEN cp.title ~* '\b(peugeot)\b' THEN 'PEUGEOT'
      WHEN cp.title ~* '\b(renault)\b' THEN 'RENAULT'
      WHEN cp.title ~* '\b(citroen)\b' THEN 'CITROEN'
      WHEN cp.title ~* '\b(alfa\s*romeo)\b' THEN 'ALFAROMEO'
      WHEN cp.title ~* '\b(tesla)\b' THEN 'TESLA'
      WHEN cp.title ~* '\b(genesis)\b' THEN 'GENESIS'
      WHEN cp.title ~* '\b(isuzu)\b' THEN 'ISUZU'
      WHEN cp.title ~* '\b(freightliner)\b' THEN 'FREIGHTLINER'
      WHEN cp.title ~* '\b(peterbilt)\b' THEN 'PETERBILT'
      WHEN cp.title ~* '\b(kenworth)\b' THEN 'KENWORTH'
    END AS mk
  FROM "CanonicalPart" cp
  WHERE cp.compatibility IS NULL OR cp.compatibility::text IN ('null', '[]', '')
),
matched AS (
  SELECT 
    p.id,
    jsonb_agg(DISTINCT jsonb_build_object(
      'year', mv.year,
      'make', mv.make,
      'model', mv.model,
      'trim', COALESCE(mv.trim, ''),
      'engine', COALESCE(mv.engine, ''),
      'driveType', COALESCE(mv."driveType", ''),
      'fuelType', COALESCE(mv."fuelType", ''),
      'body', COALESCE(mv.body, '')
    )) AS rows
  FROM parsed p
  JOIN "MvlVehicle" mv ON mv."normalizedMake" = p.mk
    AND mv.year BETWEEN p.yr AND p.yr2
    AND mv.market = 'US'
  WHERE p.mk IS NOT NULL AND p.yr IS NOT NULL
  GROUP BY p.id
  HAVING COUNT(*) <= 200
)
UPDATE "CanonicalPart" cp
SET compatibility = m.rows
FROM matched m
WHERE cp.id = m.id;

SELECT COUNT(*) AS with_compat FROM "CanonicalPart" 
WHERE compatibility IS NOT NULL AND compatibility::text NOT IN ('null', '[]', '');
