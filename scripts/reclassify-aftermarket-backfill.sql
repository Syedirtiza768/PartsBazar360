-- OEM vs Aftermarket classification backfill.
--
-- Root cause: uploads.service.ts derived partSource/partType from a tiny
-- hardcoded brand list instead of the (already-populated) BrandMaster
-- isAftermarketBrand/isVehicleManufacturer/suppliesGenuineOem flags, so
-- most brands never got a confident AFTERMARKET classification and fell
-- through to a GENUINE_OEM default (see classification.util.ts + the
-- collapse at uploads.service.ts, both already fixed in code for future
-- ingestion). This backfill applies the same corrected logic retroactively.
--
-- Two buckets, both scoped to currently GENUINE_OEM/UNCLASSIFIED rows:
--   1) High-confidence: BrandMaster says aftermarket-only (not a vehicle
--      manufacturer, doesn't supply genuine OEM) -> reclassify AFTERMARKET.
--   2) Ambiguous, excluded from (1): CON (maps to 6+ real brands in source
--      data), TAIWAN (a country, not a brand), ORIGINAL (generic "OE"
--      placeholder), TRW/MAHLE (real dual-role OEM-and-aftermarket
--      suppliers, same ambiguity as the existing BOSCH/DENSO/MOBIS
--      MULTI_ROLE handling) -> mark UNCLASSIFIED + REVIEW_REQUIRED instead
--      of leaving them displayed as confident Genuine OEM.

BEGIN;

WITH high_confidence AS (
  SELECT cp.id
  FROM "CanonicalPart" cp
  JOIN "BrandMaster" bm
    ON bm.status = 'ACTIVE'
    AND (
      upper(trim(bm."canonicalName")) = upper(trim(cp.brand))
      OR bm.id = cp."primaryBrandId"
    )
  WHERE cp."partType" IN ('GENUINE_OEM', 'UNCLASSIFIED')
    AND bm."isAftermarketBrand"
    AND NOT bm."suppliesGenuineOem"
    AND NOT bm."isVehicleManufacturer"
    AND upper(trim(bm."canonicalName")) NOT IN ('CON', 'TAIWAN', 'ORIGINAL', 'TRW', 'MAHLE')
)
UPDATE "CanonicalPart" cp
SET "partType" = 'AFTERMARKET',
    "partSource" = 'AFTERMARKET',
    "classificationStatus" = 'CLASSIFIED',
    "classificationReason" = 'Backfill: BrandMaster identifies brand as aftermarket-only (isAftermarketBrand=true, not vehicle manufacturer, does not supply genuine OEM)',
    "updatedAt" = now()
FROM high_confidence hc
WHERE cp.id = hc.id;

WITH ambiguous AS (
  SELECT cp.id
  FROM "CanonicalPart" cp
  JOIN "BrandMaster" bm
    ON bm.status = 'ACTIVE'
    AND (
      upper(trim(bm."canonicalName")) = upper(trim(cp.brand))
      OR bm.id = cp."primaryBrandId"
    )
  WHERE cp."partType" IN ('GENUINE_OEM', 'UNCLASSIFIED')
    AND bm."isAftermarketBrand"
    AND NOT bm."suppliesGenuineOem"
    AND NOT bm."isVehicleManufacturer"
    AND upper(trim(bm."canonicalName")) IN ('CON', 'TAIWAN', 'ORIGINAL', 'TRW', 'MAHLE')
)
UPDATE "CanonicalPart" cp
SET "partType" = 'UNCLASSIFIED',
    "classificationStatus" = 'REVIEW_REQUIRED',
    "classificationReason" = 'Backfill: brand is generic/ambiguous (CON, TAIWAN, ORIGINAL) or a known dual-role OEM-and-aftermarket supplier (TRW, MAHLE) — needs manual review, not auto-classified',
    "updatedAt" = now()
FROM ambiguous am
WHERE cp.id = am.id;

COMMIT;
