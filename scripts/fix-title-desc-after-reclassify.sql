-- After the OEM/Aftermarket classification backfill, titles/descriptions
-- generated under the old (wrong) classification still assert "Genuine OEM"
-- text that now contradicts partType. Fix wherever partType no longer
-- matches the baked-in claim, regardless of which pass caused the mismatch.

BEGIN;

-- AFTERMARKET rows: "... - Genuine OEM" -> "... - New Aftermarket"
UPDATE "CanonicalPart"
SET title = regexp_replace(title, '- Genuine OEM$', '- New Aftermarket'),
    description = regexp_replace(description, '^Genuine OEM ', 'Aftermarket '),
    "updatedAt" = now()
WHERE "partType" = 'AFTERMARKET'
  AND (title ~ '- Genuine OEM$' OR description ~ '^Genuine OEM ');

-- UNCLASSIFIED rows: strip the unverified "Genuine OEM" claim rather than
-- assert a different unverified one.
UPDATE "CanonicalPart"
SET title = trim(trailing ' -' from regexp_replace(title, '- Genuine OEM$', '')),
    description = regexp_replace(description, '^Genuine OEM ', ''),
    "updatedAt" = now()
WHERE "partType" = 'UNCLASSIFIED'
  AND (title ~ '- Genuine OEM$' OR description ~ '^Genuine OEM ');

COMMIT;
