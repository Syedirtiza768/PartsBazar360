-- Phase 2 of the Dynatrade brand-code fix: the structured columns (brand,
-- manufacturer, title, BrandMaster) are already corrected. This pass fixes
-- the remaining free-text artifacts that were generated FROM the bad brand
-- value before the phase-1 fix: CanonicalPart.description, and the
-- itemSpecifics.detailBullets JSON string.
--
-- Anchored, word-boundary replacements only (surrounded by non-alnum or
-- string edges) to avoid mangling unrelated substrings.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM brand_map LIMIT 1) THEN
    RAISE EXCEPTION 'brand_map is empty — load it before running this script';
  END IF;
END $$;

-- description: "...brand LEM." -> "...brand LEMFORDER."
UPDATE "CanonicalPart" cp
SET description = regexp_replace(
  cp.description,
  '\mbrand ' || bm.code || '\M',
  'brand ' || bm.fullname,
  'g'
)
FROM brand_map bm
WHERE bm.code <> bm.fullname
  AND cp.description ~ ('\mbrand ' || bm.code || '\M');

-- itemSpecifics.detailBullets: "Brand: LEM" / "Manufacturer: LEM" -> fullname
UPDATE "CanonicalPart" cp
SET "itemSpecifics" = jsonb_set(
  cp."itemSpecifics",
  '{detailBullets}',
  to_jsonb(
    regexp_replace(
      regexp_replace(
        cp."itemSpecifics"->>'detailBullets',
        '(Brand:\s*)' || bm.code || '\M', '\1' || bm.fullname, 'g'
      ),
      '(Manufacturer:\s*)' || bm.code || '\M', '\1' || bm.fullname, 'g'
    )
  )
)
FROM brand_map bm
WHERE bm.code <> bm.fullname
  AND cp."itemSpecifics" ? 'detailBullets'
  AND (
    cp."itemSpecifics"->>'detailBullets' ~ ('(Brand:\s*)' || bm.code || '\M')
    OR cp."itemSpecifics"->>'detailBullets' ~ ('(Manufacturer:\s*)' || bm.code || '\M')
  );

COMMIT;
