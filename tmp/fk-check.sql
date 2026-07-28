SELECT conrelid::regclass AS from_table,
       pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid = '"SellerOffer"'::regclass;

SELECT relname, n_live_tup, n_dead_tup
FROM pg_stat_user_tables
WHERE relname IN ('SellerOffer','Inventory','SourceRecord','SellerUploadRow','CartItem','OrderItem','SalvageUnit','OfferPrice','SupportTicket')
ORDER BY relname;
