-- Multi-market MVL: US / DE / UK / AU

ALTER TABLE "MvlVehicle" ADD COLUMN IF NOT EXISTS "kType" TEXT;
ALTER TABLE "MvlVehicle" ADD COLUMN IF NOT EXISTS "market" TEXT;
ALTER TABLE "MvlVehicle" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;

-- Backfill existing US rows
UPDATE "MvlVehicle"
SET
  "market" = COALESCE(NULLIF("market", ''), 'US'),
  "sourceKey" = COALESCE(NULLIF("sourceKey", ''), 'US:' || "epid")
WHERE "epid" IS NOT NULL AND ("market" IS NULL OR "sourceKey" IS NULL OR "market" = '' OR "sourceKey" = '');

-- Drop old epid-only unique if present
ALTER TABLE "MvlVehicle" DROP CONSTRAINT IF EXISTS "MvlVehicle_epid_key";
DROP INDEX IF EXISTS "MvlVehicle_epid_key";

-- epid becomes optional
ALTER TABLE "MvlVehicle" ALTER COLUMN "epid" DROP NOT NULL;

-- Require market + sourceKey
ALTER TABLE "MvlVehicle" ALTER COLUMN "market" SET NOT NULL;
ALTER TABLE "MvlVehicle" ALTER COLUMN "sourceKey" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "MvlVehicle_market_sourceKey_key"
  ON "MvlVehicle"("market", "sourceKey");
CREATE INDEX IF NOT EXISTS "MvlVehicle_epid_idx" ON "MvlVehicle"("epid");
CREATE INDEX IF NOT EXISTS "MvlVehicle_kType_idx" ON "MvlVehicle"("kType");
CREATE INDEX IF NOT EXISTS "MvlVehicle_market_year_normalizedMake_idx"
  ON "MvlVehicle"("market", "year", "normalizedMake");
