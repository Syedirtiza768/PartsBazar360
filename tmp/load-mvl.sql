-- Load MVL CSV (header row) into MvlVehicle. Idempotent on epid.
-- Usage inside postgres container:
--   \copy mvl_stage FROM '/tmp/us_mvl_2026_05.csv' CSV HEADER

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
  "numDoors" INT,
  "normalizedMake" TEXT,
  "normalizedModel" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

-- Caller runs COPY into mvl_stage, then:

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
  NULLIF("partsModel", ''), "numDoors",
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
