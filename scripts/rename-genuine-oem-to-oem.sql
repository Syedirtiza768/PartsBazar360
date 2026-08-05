-- Rename the "Genuine OEM" label to "OEM" everywhere it's baked into
-- stored listing text, and correct stale "Genuine OEM" text left over on
-- rows that were reclassified to AFTERMARKET earlier today but whose
-- itemSpecifics.brandType/detailBullets fields weren't touched by that
-- pass (only title/description were).

BEGIN;

-- title: "... - Genuine OEM" -> "... - OEM", only for rows still
-- classified GENUINE_OEM (title suffix should reflect current partType).
UPDATE "CanonicalPart"
SET title = regexp_replace(title, '- Genuine OEM$', '- OEM'),
    "updatedAt" = now()
WHERE "partType" = 'GENUINE_OEM'
  AND title ~ '- Genuine OEM$';

-- description: "Genuine OEM ..." -> "OEM ..."
UPDATE "CanonicalPart"
SET description = regexp_replace(description, '^Genuine OEM ', 'OEM '),
    "updatedAt" = now()
WHERE "partType" = 'GENUINE_OEM'
  AND description ~ '^Genuine OEM ';

-- itemSpecifics.brandType: sync to whatever the CURRENT partType actually
-- is, wherever it still says the old "Genuine OEM" text (covers both
-- today's OEM rename and leftover staleness from the earlier AFTERMARKET
-- backfill, which didn't touch this field).
UPDATE "CanonicalPart"
SET "itemSpecifics" = jsonb_set(
      "itemSpecifics", '{brandType}',
      to_jsonb(
        CASE "partType"
          WHEN 'GENUINE_OEM' THEN 'OEM'
          WHEN 'AFTERMARKET' THEN 'Aftermarket'
          WHEN 'SALVAGE_OEM' THEN 'Salvage OEM'
          ELSE NULL
        END
      )
    ),
    "updatedAt" = now()
WHERE "itemSpecifics" ? 'brandType'
  AND "itemSpecifics"->>'brandType' = 'Genuine OEM'
  AND "partType" IN ('GENUINE_OEM', 'AFTERMARKET', 'SALVAGE_OEM');

-- Strip it outright for UNCLASSIFIED rows rather than assert any label.
UPDATE "CanonicalPart"
SET "itemSpecifics" = "itemSpecifics" - 'brandType',
    "updatedAt" = now()
WHERE "itemSpecifics" ? 'brandType'
  AND "itemSpecifics"->>'brandType' = 'Genuine OEM'
  AND "partType" = 'UNCLASSIFIED';

-- itemSpecifics.detailBullets: replace the "Genuine OEM" substring with the
-- current partType's label (frontend already filters Condition/Quality
-- Tier bullets at render time, but the stored text should still be
-- accurate for anyone reading the raw API/DB).
UPDATE "CanonicalPart"
SET "itemSpecifics" = jsonb_set(
      "itemSpecifics", '{detailBullets}',
      to_jsonb(
        regexp_replace(
          "itemSpecifics"->>'detailBullets',
          'Genuine OEM',
          CASE "partType"
            WHEN 'GENUINE_OEM' THEN 'OEM'
            WHEN 'AFTERMARKET' THEN 'Aftermarket'
            WHEN 'SALVAGE_OEM' THEN 'Salvage OEM'
            ELSE 'Unclassified'
          END,
          'g'
        )
      )
    ),
    "updatedAt" = now()
WHERE "itemSpecifics" ? 'detailBullets'
  AND "itemSpecifics"->>'detailBullets' ~ 'Genuine OEM';

COMMIT;
