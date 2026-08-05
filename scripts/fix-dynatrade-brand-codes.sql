-- Surgical fix for Dynatrade stock-list ingestion bug: a broken brand-lookup
-- formula in the source spreadsheet caused internal short codes (LEM, FBI,
-- BSH, MEY, ...) to be stored as the actual brand instead of the real name.
-- brand_map(code, fullname) must already be loaded (see COPY step) before
-- running this file. CON is intentionally excluded (ambiguous: maps to 6+
-- different real brands in the source data) and left for manual review.
--
-- Wrapped in one transaction: either the whole fix lands or none of it does.

BEGIN;

-- Sanity: brand_map must be present.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM brand_map LIMIT 1) THEN
    RAISE EXCEPTION 'brand_map is empty — load it before running this script';
  END IF;
END $$;

-- 1) Repoint FKs for the 34 codes whose correct-named BrandMaster row
--    already exists separately (merge), then alias the old code onto it.
WITH conflicts AS (
  SELECT
    bm_old.id AS old_id,
    bm_new.id AS new_id,
    bm.code AS code
  FROM brand_map bm
  JOIN "BrandMaster" bm_old ON upper(trim(bm_old."canonicalName")) = bm.code
  JOIN "BrandMaster" bm_new ON upper(trim(bm_new."canonicalName")) = upper(bm.fullname)
  WHERE bm.code <> bm.fullname AND bm_old.id <> bm_new.id
)
UPDATE "CanonicalPart" cp
SET "primaryBrandId" = c.new_id
FROM conflicts c
WHERE cp."primaryBrandId" = c.old_id;

WITH conflicts AS (
  SELECT bm_old.id AS old_id, bm_new.id AS new_id
  FROM brand_map bm
  JOIN "BrandMaster" bm_old ON upper(trim(bm_old."canonicalName")) = bm.code
  JOIN "BrandMaster" bm_new ON upper(trim(bm_new."canonicalName")) = upper(bm.fullname)
  WHERE bm.code <> bm.fullname AND bm_old.id <> bm_new.id
)
UPDATE "CatalogPartNumber" cpn
SET "brandId" = c.new_id
FROM conflicts c
WHERE cpn."brandId" = c.old_id;

WITH conflicts AS (
  SELECT bm_old.id AS old_id, bm_new.id AS new_id
  FROM brand_map bm
  JOIN "BrandMaster" bm_old ON upper(trim(bm_old."canonicalName")) = bm.code
  JOIN "BrandMaster" bm_new ON upper(trim(bm_new."canonicalName")) = upper(bm.fullname)
  WHERE bm.code <> bm.fullname AND bm_old.id <> bm_new.id
)
UPDATE "BrandAlias" ba
SET "brandId" = c.new_id
FROM conflicts c
WHERE ba."brandId" = c.old_id;

-- Record the old abbreviation as a searchable alias on the surviving brand.
INSERT INTO "BrandAlias" (id, "brandId", alias, normalized, source)
SELECT gen_random_uuid(), bm_new.id, bm.code, lower(bm.code), 'dynatrade-merge'
FROM brand_map bm
JOIN "BrandMaster" bm_old ON upper(trim(bm_old."canonicalName")) = bm.code
JOIN "BrandMaster" bm_new ON upper(trim(bm_new."canonicalName")) = upper(bm.fullname)
WHERE bm.code <> bm.fullname AND bm_old.id <> bm_new.id
ON CONFLICT ("brandId", normalized) DO NOTHING;

-- Mark the merged-away old rows so they're never picked as primary again,
-- without deleting them (preserves audit trail / any other FK we missed).
UPDATE "BrandMaster" bm_old
SET status = 'MERGED', "updatedAt" = now()
FROM brand_map bm
JOIN "BrandMaster" bm_new ON upper(trim(bm_new."canonicalName")) = upper(bm.fullname)
WHERE upper(trim(bm_old."canonicalName")) = bm.code
  AND bm.code <> bm.fullname
  AND bm_old.id <> bm_new.id;

-- 2) Rename in place the 33 codes with no existing conflicting row.
UPDATE "BrandMaster" bm_old
SET "canonicalName" = bm.fullname,
    "displayName" = bm.fullname,
    "updatedAt" = now()
FROM brand_map bm
WHERE upper(trim(bm_old."canonicalName")) = bm.code
  AND bm.code <> bm.fullname
  AND NOT EXISTS (
    SELECT 1 FROM "BrandMaster" bm_new
    WHERE upper(trim(bm_new."canonicalName")) = upper(bm.fullname)
      AND bm_new.id <> bm_old.id
  );

INSERT INTO "BrandAlias" (id, "brandId", alias, normalized, source)
SELECT gen_random_uuid(), bm_new.id, bm.code, lower(bm.code), 'dynatrade-rename'
FROM brand_map bm
JOIN "BrandMaster" bm_new ON upper(trim(bm_new."canonicalName")) = upper(bm.fullname)
WHERE bm.code <> bm.fullname
ON CONFLICT ("brandId", normalized) DO NOTHING;

-- 3) Fix the free-text brand/manufacturer fields on CanonicalPart.
UPDATE "CanonicalPart" cp
SET brand = bm.fullname
FROM brand_map bm
WHERE upper(trim(cp.brand)) = bm.code AND bm.code <> bm.fullname;

UPDATE "CanonicalPart" cp
SET manufacturer = bm.fullname
FROM brand_map bm
WHERE upper(trim(cp.manufacturer)) = bm.code AND bm.code <> bm.fullname;

-- 4) Fix titles where the code is the literal leading word
--    (e.g. "LEM Control Arm ..." -> "LEMFORDER Control Arm ...").
UPDATE "CanonicalPart" cp
SET title = bm.fullname || substring(cp.title from length(bm.code) + 1)
FROM brand_map bm
WHERE bm.code <> bm.fullname
  AND cp.title LIKE bm.code || ' %'
  -- exact-word guard: character right after the code must be a space
  -- (already enforced by LIKE 'CODE %'), and title must not already start
  -- with a longer word that happens to share this prefix.
  AND split_part(cp.title, ' ', 1) = bm.code;

COMMIT;
