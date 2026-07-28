-- Last sync / staging freshness for RealTrack-origin offers
SELECT
  s.name AS seller,
  o.status,
  COUNT(*) AS offers,
  MIN(o."updatedAt") AS oldest_offer_update,
  MAX(o."updatedAt") AS newest_offer_update,
  MIN(o."createdAt") AS oldest_offer_create,
  MAX(o."createdAt") AS newest_offer_create
FROM "Seller" s
JOIN "SellerOffer" o ON o."sellerId" = s.id
WHERE s.name ILIKE '%salvage%'
   OR s.name ILIKE '%blackline%'
   OR s."storeId" IN (
     'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0',
     'd16199c4-55b5-429e-ad27-892bed94e00d',
     '3b84b063-3811-481f-a61d-f7846a03558f'
   )
GROUP BY s.name, o.status
ORDER BY s.name, offers DESC;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'RawStagingListing'
ORDER BY ordinal_position;

SELECT COUNT(*) AS staging_rows FROM "RawStagingListing";
