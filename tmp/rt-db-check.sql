SELECT s.id, s.name, COUNT(o.id) AS offers, COUNT(DISTINCT o."canonicalPartId") AS parts
FROM "Seller" s
LEFT JOIN "SellerOffer" o ON o."sellerId" = s.id AND o.status = 'ACTIVE'
WHERE s.name ILIKE '%salvage%' OR s.name ILIKE '%blackline%' OR s.id ILIKE '%salvage%' OR s.id ILIKE '%blackline%'
GROUP BY s.id, s.name
ORDER BY s.name;

SELECT "sourcePlatform", COUNT(*) AS staging_count
FROM "RawStagingListing"
GROUP BY "sourcePlatform"
ORDER BY staging_count DESC
LIMIT 20;

SELECT
  COUNT(*) AS parts,
  COUNT(*) FILTER (WHERE cardinality("imageUrls") > 0) AS with_any_image,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest("imageUrls") u WHERE u ILIKE '%ebay%')) AS with_ebay_image,
  ROUND(AVG(cardinality("imageUrls"))::numeric, 2) AS avg_images,
  COUNT(*) FILTER (WHERE "compatibility" IS NOT NULL) AS with_compat_json,
  COUNT(*) FILTER (WHERE description IS NOT NULL AND description <> '') AS with_description
FROM "CanonicalPart" cp
WHERE EXISTS (
  SELECT 1 FROM "SellerOffer" o
  JOIN "Seller" s ON s.id = o."sellerId"
  WHERE o."canonicalPartId" = cp.id
    AND (s.name ILIKE '%salvage%' OR s.name ILIKE '%blackline%')
);

SELECT COUNT(*) AS fitment_rows
FROM "Fitment" f
WHERE EXISTS (
  SELECT 1 FROM "SellerOffer" o
  JOIN "Seller" s ON s.id = o."sellerId"
  WHERE o."canonicalPartId" = f."canonicalPartId"
    AND (s.name ILIKE '%salvage%' OR s.name ILIKE '%blackline%')
);

SELECT cp.title, cardinality(cp."imageUrls") AS imgs,
  (SELECT COUNT(*) FROM "Fitment" f WHERE f."canonicalPartId" = cp.id) AS fitments,
  LEFT(cp."imageUrls"[1], 80) AS first_image
FROM "CanonicalPart" cp
JOIN "SellerOffer" o ON o."canonicalPartId" = cp.id
JOIN "Seller" s ON s.id = o."sellerId"
WHERE s.name ILIKE '%salvage%' OR s.name ILIKE '%blackline%'
ORDER BY imgs DESC NULLS LAST
LIMIT 5;
