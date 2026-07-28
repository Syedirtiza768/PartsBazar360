SELECT indexname, indexdef FROM pg_indexes WHERE tablename='SellerOffer';
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='"SellerOffer"'::regclass AND NOT tgisinternal;
SELECT COUNT(*) AS offers FROM "SellerOffer" WHERE "sellerId" IN ('seller-salvage-auto-parts','79aa9032-e0af-4836-bf19-100bd922c7ae','21924d3c-b345-4dcd-900c-b4bcf92b01c0');
EXPLAIN (ANALYZE, BUFFERS)
DELETE FROM "SellerOffer" WHERE id IN (
  SELECT id FROM "SellerOffer"
  WHERE "sellerId"='seller-salvage-auto-parts'
  LIMIT 50
);
