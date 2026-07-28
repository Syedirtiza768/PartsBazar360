-- Simple MVL compat build - match by extracting make from title
-- Only processes salvage seller parts (sellerId = 'seller-salvage-auto-parts')

WITH salvage_parts AS (
  SELECT DISTINCT cp.id, cp.title
  FROM "CanonicalPart" cp
  JOIN "SellerOffer" so ON so."canonicalPartId" = cp.id
  WHERE so."sellerId" = 'seller-salvage-auto-parts'
  AND (cp.compatibility IS NULL OR cp.compatibility::text IN ('null', '[]', ''))
),
-- Extract year from title
with_year AS (
  SELECT id, title,
    CASE WHEN title ~ '\d{4}' THEN (regexp_match(title, '(\d{4})'))[1]::int ELSE NULL END AS yr
  FROM salvage_parts
),
-- Match against MVL by simple string matching on make
matched AS (
  SELECT 
    wy.id,
    jsonb_agg(DISTINCT jsonb_build_object(
      'year', mv.year,
      'make', mv.make,
      'model', mv.model,
      'trim', COALESCE(mv.trim, ''),
      'engine', COALESCE(mv.engine, '')
    )) AS rows
  FROM with_year wy
  JOIN "MvlVehicle" mv ON (
    mv.market = 'US'
    AND mv.year = wy.yr
    AND (
      (wy.title ~* 'audi' AND mv."normalizedMake" = 'AUDI')
      OR (wy.title ~* 'bmw' AND mv."normalizedMake" = 'BMW')
      OR (wy.title ~* 'jaguar' AND mv."normalizedMake" = 'JAGUAR')
      OR (wy.title ~* 'lexus' AND mv."normalizedMake" = 'LEXUS')
      OR (wy.title ~* 'mercedes' AND mv."normalizedMake" = 'MERCEDESBENZ')
      OR (wy.title ~* 'ford' AND mv."normalizedMake" = 'FORD')
      OR (wy.title ~* 'chevrolet|chevy' AND mv."normalizedMake" = 'CHEVROLET')
      OR (wy.title ~* 'toyota' AND mv."normalizedMake" = 'TOYOTA')
      OR (wy.title ~* 'nissan' AND mv."normalizedMake" = 'NISSAN')
      OR (wy.title ~* 'honda' AND mv."normalizedMake" = 'HONDA')
      OR (wy.title ~* 'dodge' AND mv."normalizedMake" = 'DODGE')
      OR (wy.title ~* 'volkswagen|vw' AND mv."normalizedMake" = 'VOLKSWAGEN')
      OR (wy.title ~* 'mazda' AND mv."normalizedMake" = 'MAZDA')
      OR (wy.title ~* 'cadillac' AND mv."normalizedMake" = 'CADILLAC')
      OR (wy.title ~* 'porsche' AND mv."normalizedMake" = 'PORSCHE')
      OR (wy.title ~* 'gmc' AND mv."normalizedMake" = 'GMC')
      OR (wy.title ~* 'buick' AND mv."normalizedMake" = 'BUICK')
      OR (wy.title ~* 'chrysler' AND mv."normalizedMake" = 'CHRYSLER')
      OR (wy.title ~* 'jeep' AND mv."normalizedMake" = 'JEEP')
      OR (wy.title ~* 'kia' AND mv."normalizedMake" = 'KIA')
      OR (wy.title ~* 'hyundai' AND mv."normalizedMake" = 'HYUNDAI')
      OR (wy.title ~* 'infiniti' AND mv."normalizedMake" = 'INFINITI')
      OR (wy.title ~* 'acura' AND mv."normalizedMake" = 'ACURA')
      OR (wy.title ~* 'subaru' AND mv."normalizedMake" = 'SUBARU')
      OR (wy.title ~* 'mitsubishi' AND mv."normalizedMake" = 'MITSUBISHI')
      OR (wy.title ~* 'volvo' AND mv."normalizedMake" = 'VOLVO')
      OR (wy.title ~* 'land rover' AND mv."normalizedMake" = 'LANDROVER')
      OR (wy.title ~* 'range rover' AND mv."normalizedMake" = 'RANGEROVER')
      OR (wy.title ~* 'mini' AND mv."normalizedMake" = 'MINI')
      OR (wy.title ~* 'maserati' AND mv."normalizedMake" = 'MASERATI')
      OR (wy.title ~* 'bentley' AND mv."normalizedMake" = 'BENTLEY')
      OR (wy.title ~* 'rolls' AND mv."normalizedMake" = 'ROLLSROYCE')
      OR (wy.title ~* 'ram' AND mv."normalizedMake" = 'RAM')
      OR (wy.title ~* 'fiat' AND mv."normalizedMake" = 'FIAT')
      OR (wy.title ~* 'saab' AND mv."normalizedMake" = 'SAAB')
      OR (wy.title ~* 'pontiac' AND mv."normalizedMake" = 'PONTIAC')
      OR (wy.title ~* 'scion' AND mv."normalizedMake" = 'SCION')
      OR (wy.title ~* 'suzuki' AND mv."normalizedMake" = 'SUZUKI')
      OR (wy.title ~* 'tesla' AND mv."normalizedMake" = 'TESLA')
      OR (wy.title ~* 'genesis' AND mv."normalizedMake" = 'GENESIS')
      OR (wy.title ~* 'isuzu' AND mv."normalizedMake" = 'ISUZU')
      OR (wy.title ~* 'lincoln' AND mv."normalizedMake" = 'LINCOLN')
    )
  )
  WHERE wy.yr IS NOT NULL
  GROUP BY wy.id
  HAVING COUNT(*) <= 200
)
UPDATE "CanonicalPart" cp
SET compatibility = m.rows
FROM matched m
WHERE cp.id = m.id;

SELECT COUNT(*) AS with_compat FROM "CanonicalPart" 
WHERE compatibility IS NOT NULL AND compatibility::text NOT IN ('null', '[]', '');
