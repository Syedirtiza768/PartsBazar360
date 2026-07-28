-- Inspect FKs referencing SellerOffer and existing indexes
SELECT conrelid::regclass AS from_table, a.attname AS from_col, confrelid::regclass AS to_table
FROM pg_constraint c
JOIN latERAL unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = cols.attnum
WHERE c.contype = 'f'
  AND confrelid = '"SellerOffer"'::regclass
ORDER BY 1, 2;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN (
  'SellerOffer','Inventory','OfferPrice','CartItem','OrderItem','SalvageUnit',
  'SellerUploadRow','SourceRecord','SupportTicket'
)
ORDER BY tablename, indexname;

SELECT COUNT(*) AS offers_still FROM "SellerOffer" o
JOIN "Seller" s ON s.id = o."sellerId"
WHERE s.name ILIKE '%Blackline%'
   OR s.name IN ('Salvage Auto Parts','K. Salvage Auto Parts')
   OR s."storeId" IN (
     'd16199c4-55b5-429e-ad27-892bed94e00d',
     '3b84b063-3811-481f-a61d-f7846a03558f',
     'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0'
   );
