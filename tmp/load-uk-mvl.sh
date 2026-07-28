#!/bin/sh
set -eu
# Load only UK CSV with DISTINCT ON dedupe
docker cp /tmp/mvl_UK.csv partsbazar360-postgres-1:/tmp/mvl_UK.csv
docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
CREATE TEMP TABLE mvl_stage (
  id TEXT,
  epid TEXT,
  "kType" TEXT,
  market TEXT,
  "sourceKey" TEXT,
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

\copy mvl_stage FROM '/tmp/mvl_UK.csv' CSV HEADER

SELECT COUNT(*) AS stage_rows, COUNT(DISTINCT "sourceKey") AS distinct_keys FROM mvl_stage;

INSERT INTO "MvlVehicle" (
  id, epid, "kType", market, "sourceKey", year, make, model, trim, submodel, engine,
  "driveType", "fuelType", body, aspiration, "displayName", region, "partsModel", "numDoors",
  "normalizedMake", "normalizedModel", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (market, "sourceKey")
  id,
  NULLIF(epid, ''),
  NULLIF("kType", ''),
  market,
  "sourceKey",
  year, make, model,
  NULLIF(trim, ''), NULLIF(submodel, ''), NULLIF(engine, ''),
  NULLIF("driveType", ''), NULLIF("fuelType", ''), NULLIF(body, ''),
  NULLIF(aspiration, ''), NULLIF("displayName", ''), NULLIF(region, ''),
  NULLIF("partsModel", ''),
  CASE WHEN "numDoors" ~ '^[0-9]+$' THEN "numDoors"::int ELSE NULL END,
  "normalizedMake", "normalizedModel",
  COALESCE("createdAt", NOW()), COALESCE("updatedAt", NOW())
FROM mvl_stage
ORDER BY market, "sourceKey"
ON CONFLICT (market, "sourceKey") DO UPDATE SET
  epid = EXCLUDED.epid,
  "kType" = EXCLUDED."kType",
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

SELECT market, COUNT(*) AS n FROM "MvlVehicle" GROUP BY 1 ORDER BY 1;
SELECT COUNT(*) AS total FROM "MvlVehicle";
SQL
echo UK_LOAD_DONE
