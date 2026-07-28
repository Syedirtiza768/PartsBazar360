#!/usr/bin/env bash
set -euo pipefail
# Apply multi-market MVL schema and load CSVs from /tmp/mvl_*.csv

docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
ALTER TABLE "MvlVehicle" ADD COLUMN IF NOT EXISTS "kType" TEXT;
ALTER TABLE "MvlVehicle" ADD COLUMN IF NOT EXISTS "market" TEXT;
ALTER TABLE "MvlVehicle" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;

UPDATE "MvlVehicle"
SET
  "market" = COALESCE(NULLIF("market", ''), 'US'),
  "sourceKey" = COALESCE(NULLIF("sourceKey", ''), 'US:' || "epid")
WHERE "epid" IS NOT NULL AND ("market" IS NULL OR "sourceKey" IS NULL OR "market" = '' OR "sourceKey" = '');

ALTER TABLE "MvlVehicle" DROP CONSTRAINT IF EXISTS "MvlVehicle_epid_key";
DROP INDEX IF EXISTS "MvlVehicle_epid_key";
ALTER TABLE "MvlVehicle" ALTER COLUMN "epid" DROP NOT NULL;
ALTER TABLE "MvlVehicle" ALTER COLUMN "market" SET NOT NULL;
ALTER TABLE "MvlVehicle" ALTER COLUMN "sourceKey" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "MvlVehicle_market_sourceKey_key"
  ON "MvlVehicle"("market", "sourceKey");
CREATE INDEX IF NOT EXISTS "MvlVehicle_epid_idx" ON "MvlVehicle"("epid");
CREATE INDEX IF NOT EXISTS "MvlVehicle_kType_idx" ON "MvlVehicle"("kType");
CREATE INDEX IF NOT EXISTS "MvlVehicle_market_year_normalizedMake_idx"
  ON "MvlVehicle"("market", "year", "normalizedMake");
SQL

load_one() {
  local market="$1"
  local csv="$2"
  echo "LOADING $market from $csv"
  docker cp "$csv" "partsbazar360-postgres-1:/tmp/mvl_${market}.csv"
  docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<SQL
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

\\copy mvl_stage FROM '/tmp/mvl_${market}.csv' CSV HEADER

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
SQL
}

# Prefer new multi-market CSVs; fall back to regenerating US if needed
for m in US DE UK AU; do
  if [ -f "/tmp/mvl_${m}.csv" ]; then
    load_one "$m" "/tmp/mvl_${m}.csv"
  else
    echo "SKIP missing /tmp/mvl_${m}.csv"
  fi
done

docker exec -i partsbazar360-postgres-1 psql -U partsbazar_user -d partsbazar_db <<'SQL'
SELECT market, COUNT(*) AS n FROM "MvlVehicle" GROUP BY 1 ORDER BY 1;
SELECT COUNT(*) AS total FROM "MvlVehicle";
SQL
echo MULTI_MVL_LOAD_DONE
