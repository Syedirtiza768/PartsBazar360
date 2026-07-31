-- Idempotent migration: handles both fresh DBs and existing DBs where
-- sourceTag may already exist with old tag names (FEB, DYN, TRU, DXB, SPC, SPD).

-- Ensure sourceTag column exists at VARCHAR(8) (new tags like YNTD need 4+ chars)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'SellerOffer' AND column_name = 'sourceTag'
  ) THEN
    ALTER TABLE "SellerOffer" ADD COLUMN "sourceTag" VARCHAR(8);
  ELSE
    ALTER TABLE "SellerOffer" ALTER COLUMN "sourceTag" TYPE VARCHAR(8);
  END IF;
END $$;

-- Ensure index exists
CREATE INDEX IF NOT EXISTS "SellerOffer_sourceTag_idx" ON "SellerOffer"("sourceTag");

-- Rename old tag names → new (no-ops on fresh DB or if already renamed)
UPDATE "SellerOffer" SET "sourceTag" = 'BST'  WHERE "sourceTag" = 'FEB';
UPDATE "SellerOffer" SET "sourceTag" = 'AAP'  WHERE "sourceTag" = 'DXB';
UPDATE "SellerOffer" SET "sourceTag" = 'YNTD' WHERE "sourceTag" = 'DYN';
UPDATE "SellerOffer" SET "sourceTag" = 'PSRC' WHERE "sourceTag" IN ('SPC', 'SPD');
UPDATE "SellerOffer" SET "sourceTag" = 'TNRU' WHERE "sourceTag" = 'TRU';

-- Backfill: RealTrack sellers (Salvage = SAL, Blackline = BLK)
UPDATE "SellerOffer" so
SET "sourceTag" = 'SAL'
FROM "Seller" s
WHERE so."sellerId" = s.id
  AND s."storeId" = '3b84b063-3811-481f-a61d-f7846a03558f'
  AND so."sourceTag" IS NULL;

UPDATE "SellerOffer" so
SET "sourceTag" = 'BLK'
FROM "Seller" s
WHERE so."sellerId" = s.id
  AND s."storeId" = 'd16199c4-55b5-429e-ad27-892bed94e00d'
  AND so."sourceTag" IS NULL;

-- Backfill: Spreadsheet uploads via SourceRecord template info (new tag names)
UPDATE "SellerOffer" so
SET "sourceTag" = 'BST'
FROM "SourceRecord" sr
WHERE so."id" = sr."sellerOfferId"
  AND sr."transformations"->>'template' = 'FEBEST_AVAILABILITY'
  AND so."sourceTag" IS NULL;

UPDATE "SellerOffer" so
SET "sourceTag" = 'YNTD'
FROM "SourceRecord" sr
WHERE so."id" = sr."sellerOfferId"
  AND sr."transformations"->>'template' = 'DYNATRADE_STOCK'
  AND so."sourceTag" IS NULL;

UPDATE "SellerOffer" so
SET "sourceTag" = 'TNRU'
FROM "SourceRecord" sr
WHERE so."id" = sr."sellerOfferId"
  AND sr."transformations"->>'template' = 'TRADE_UNION'
  AND so."sourceTag" IS NULL;

UPDATE "SellerOffer" so
SET "sourceTag" = 'AAP'
FROM "SourceRecord" sr
WHERE so."id" = sr."sellerOfferId"
  AND sr."transformations"->>'template' = 'DXB_EXW'
  AND so."sourceTag" IS NULL;

UPDATE "SellerOffer" so
SET "sourceTag" = 'PSRC'
FROM "SourceRecord" sr
WHERE so."id" = sr."sellerOfferId"
  AND sr."transformations"->>'template' IN ('SPARCO_STOCK', 'SPARCO_DEAD_STOCK')
  AND so."sourceTag" IS NULL;

-- Everything still NULL is GENERIC
UPDATE "SellerOffer"
SET "sourceTag" = 'GEN'
WHERE "sourceTag" IS NULL;
