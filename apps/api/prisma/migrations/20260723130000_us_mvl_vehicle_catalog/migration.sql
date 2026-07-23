-- US MVL (eBay Motors Vehicle List) + VehicleConfiguration.epid for verified fitment.

ALTER TABLE "VehicleConfiguration" ADD COLUMN IF NOT EXISTS "epid" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VehicleConfiguration_epid_key'
  ) THEN
    ALTER TABLE "VehicleConfiguration" ADD CONSTRAINT "VehicleConfiguration_epid_key" UNIQUE ("epid");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MvlVehicle" (
    "id" TEXT NOT NULL,
    "epid" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT,
    "submodel" TEXT,
    "engine" TEXT,
    "driveType" TEXT,
    "fuelType" TEXT,
    "body" TEXT,
    "aspiration" TEXT,
    "displayName" TEXT,
    "region" TEXT,
    "partsModel" TEXT,
    "numDoors" INTEGER,
    "normalizedMake" TEXT NOT NULL,
    "normalizedModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MvlVehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MvlVehicle_epid_key" ON "MvlVehicle"("epid");
CREATE INDEX IF NOT EXISTS "MvlVehicle_normalizedMake_normalizedModel_year_idx"
  ON "MvlVehicle"("normalizedMake", "normalizedModel", "year");
CREATE INDEX IF NOT EXISTS "MvlVehicle_year_normalizedMake_idx"
  ON "MvlVehicle"("year", "normalizedMake");

-- Deduplicate RealTrack imports by stable ebay item / listing ids when present.
CREATE UNIQUE INDEX IF NOT EXISTS "CanonicalPart_ebayItemId_uidx"
  ON "CanonicalPart"("ebayItemId")
  WHERE "ebayItemId" IS NOT NULL AND "ebayItemId" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "SellerOffer_externalOfferId_uidx"
  ON "SellerOffer"("externalOfferId")
  WHERE "externalOfferId" IS NOT NULL AND "externalOfferId" <> '';
