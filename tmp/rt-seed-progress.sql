SELECT s.name, o.status, COUNT(*) AS offers
FROM "Seller" s
JOIN "SellerOffer" o ON o."sellerId" = s.id
WHERE s."storeId" IN (
  '3b84b063-3811-481f-a61d-f7846a03558f',
  'd16199c4-55b5-429e-ad27-892bed94e00d'
)
GROUP BY s.name, o.status
ORDER BY s.name, o.status;

SELECT
  COUNT(*) AS parts,
  COUNT(*) FILTER (WHERE description IS NOT NULL AND description <> '') AS with_description,
  COUNT(*) FILTER (WHERE cardinality("imageUrls") >= 3) AS with_3plus_images,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest("imageUrls") u WHERE u ILIKE '%ebay%')) AS with_ebay_image,
  ROUND(AVG(cardinality("imageUrls"))::numeric, 2) AS avg_images
FROM "CanonicalPart" cp
WHERE EXISTS (
  SELECT 1 FROM "SellerOffer" o
  JOIN "Seller" s ON s.id = o."sellerId"
  WHERE o."canonicalPartId" = cp.id
    AND o.status = 'ACTIVE'
    AND s."storeId" IN (
      '3b84b063-3811-481f-a61d-f7846a03558f',
      'd16199c4-55b5-429e-ad27-892bed94e00d'
    )
);

SELECT COUNT(*) AS staging_processed
FROM "RawStagingListing"
WHERE processed = true
  AND "storeId" IN (
    '3b84b063-3811-481f-a61d-f7846a03558f',
    'd16199c4-55b5-429e-ad27-892bed94e00d'
  );
