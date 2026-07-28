SELECT s.name, COUNT(o.id) AS offers
FROM "Seller" s
LEFT JOIN "SellerOffer" o ON o."sellerId" = s.id
WHERE s.id IN (
  'seller-salvage-auto-parts',
  '79aa9032-e0af-4836-bf19-100bd922c7ae',
  '21924d3c-b345-4dcd-900c-b4bcf92b01c0'
)
GROUP BY s.name
ORDER BY s.name;

SELECT COUNT(*) AS staging
FROM "RawStagingListing"
WHERE "storeId" IN (
  'd16199c4-55b5-429e-ad27-892bed94e00d',
  '3b84b063-3811-481f-a61d-f7846a03558f',
  'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
);

SELECT COUNT(*) AS tmp_parts_left
FROM information_schema.tables
WHERE table_name = 'tmp_wipe_parts';
