#!/usr/bin/env bash
set -euo pipefail
# Apply MVL migration + load CSV already at /tmp/us_mvl_2026_05.csv

docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
ALTER TABLE "VehicleConfiguration" ADD COLUMN IF NOT EXISTS "epid" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleConfiguration_epid_key') THEN
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
SQL

# Unique indexes only if no dupes
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "CanonicalPart"
    WHERE "ebayItemId" IS NOT NULL AND "ebayItemId" <> ''
    GROUP BY "ebayItemId" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "CanonicalPart_ebayItemId_uidx"
      ON "CanonicalPart"("ebayItemId")
      WHERE "ebayItemId" IS NOT NULL AND "ebayItemId" <> '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "SellerOffer"
    WHERE "externalOfferId" IS NOT NULL AND "externalOfferId" <> ''
    GROUP BY "externalOfferId" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "SellerOffer_externalOfferId_uidx"
      ON "SellerOffer"("externalOfferId")
      WHERE "externalOfferId" IS NOT NULL AND "externalOfferId" <> '';
  END IF;
END $$;
SQL

docker cp /tmp/us_mvl_2026_05.csv partsbazar360-postgres-1:/tmp/us_mvl_2026_05.csv

docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
CREATE TEMP TABLE mvl_stage (
  id TEXT,
  epid TEXT,
  year INT,
  make TEXT,
  model TEXT,
  trim TEXT,
  submodel TEXT,
  engine TEXT,
  "driveType" TEXT,
  "fuelType" TEXT,
  body TEXT,
  aspiration TEXT,
  "displayName" TEXT,
  region TEXT,
  "partsModel" TEXT,
  "numDoors" TEXT,
  "normalizedMake" TEXT,
  "normalizedModel" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

\copy mvl_stage FROM '/tmp/us_mvl_2026_05.csv' CSV HEADER

INSERT INTO "MvlVehicle" (
  id, epid, year, make, model, trim, submodel, engine,
  "driveType", "fuelType", body, aspiration, "displayName", region,
  "partsModel", "numDoors", "normalizedMake", "normalizedModel",
  "createdAt", "updatedAt"
)
SELECT
  id, epid, year, make, model,
  NULLIF(trim, ''), NULLIF(submodel, ''), NULLIF(engine, ''),
  NULLIF("driveType", ''), NULLIF("fuelType", ''), NULLIF(body, ''),
  NULLIF(aspiration, ''), NULLIF("displayName", ''), NULLIF(region, ''),
  NULLIF("partsModel", ''),
  CASE WHEN "numDoors" ~ '^[0-9]+$' THEN "numDoors"::int ELSE NULL END,
  "normalizedMake", "normalizedModel",
  COALESCE("createdAt", NOW()), COALESCE("updatedAt", NOW())
FROM mvl_stage
ON CONFLICT (epid) DO UPDATE SET
  year = EXCLUDED.year,
  make = EXCLUDED.make,
  model = EXCLUDED.model,
  trim = EXCLUDED.trim,
  submodel = EXCLUDED.submodel,
  engine = EXCLUDED.engine,
  "driveType" = EXCLUDED."driveType",
  "fuelType" = EXCLUDED."fuelType",
  body = EXCLUDED.body,
  aspiration = EXCLUDED.aspiration,
  "displayName" = EXCLUDED."displayName",
  region = EXCLUDED.region,
  "partsModel" = EXCLUDED."partsModel",
  "numDoors" = EXCLUDED."numDoors",
  "normalizedMake" = EXCLUDED."normalizedMake",
  "normalizedModel" = EXCLUDED."normalizedModel",
  "updatedAt" = NOW();

SELECT COUNT(*) AS mvl_count FROM "MvlVehicle";
SQL

echo MVL_LOAD_DONE
