SELECT s.name, o.status, COUNT(*) AS offers
FROM "Seller" s
JOIN "SellerOffer" o ON o."sellerId" = s.id
WHERE s.name ILIKE '%salvage%' OR s.name ILIKE '%blackline%'
GROUP BY s.name, o.status
ORDER BY s.name, offers DESC;

SELECT
  COUNT(*) AS parts,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY cardinality("imageUrls")) AS median_images,
  MAX(cardinality("imageUrls")) AS max_images,
  COUNT(*) FILTER (WHERE cardinality("imageUrls") >= 3) AS parts_3plus_images,
  COUNT(*) FILTER (WHERE cardinality("imageUrls") >= 5) AS parts_5plus_images
FROM "CanonicalPart" cp
WHERE EXISTS (
  SELECT 1 FROM "SellerOffer" o
  JOIN "Seller" s ON s.id = o."sellerId"
  WHERE o."canonicalPartId" = cp.id
    AND (s.name ILIKE '%salvage%' OR s.name ILIKE '%blackline%')
);

WITH part_fit AS (
  SELECT cp.id, COUNT(f.id) AS fit_count
  FROM "CanonicalPart" cp
  LEFT JOIN "Fitment" f ON f."canonicalPartId" = cp.id
  WHERE EXISTS (
    SELECT 1 FROM "SellerOffer" o
    JOIN "Seller" s ON s.id = o."sellerId"
    WHERE o."canonicalPartId" = cp.id
      AND (s.name ILIKE '%salvage%' OR s.name ILIKE '%blackline%')
  )
  GROUP BY cp.id
)
SELECT
  COUNT(*) AS parts,
  COUNT(*) FILTER (WHERE fit_count = 0) AS no_fitment,
  COUNT(*) FILTER (WHERE fit_count = 1) AS one_fitment,
  COUNT(*) FILTER (WHERE fit_count BETWEEN 2 AND 5) AS fit_2_5,
  COUNT(*) FILTER (WHERE fit_count BETWEEN 6 AND 20) AS fit_6_20,
  COUNT(*) FILTER (WHERE fit_count > 20) AS fit_over_20,
  ROUND(AVG(fit_count)::numeric, 2) AS avg_fitments,
  MAX(fit_count) AS max_fitments
FROM part_fit;

SELECT LEFT(cp."imageUrls"[1], 40) AS host_prefix, COUNT(*)
FROM "CanonicalPart" cp
WHERE EXISTS (
  SELECT 1 FROM "SellerOffer" o
  JOIN "Seller" s ON s.id = o."sellerId"
  WHERE o."canonicalPartId" = cp.id
    AND (s.name ILIKE '%salvage%' OR s.name ILIKE '%blackline%')
)
AND cardinality(cp."imageUrls") > 0
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;
