-- Indexed "which parts carry this number" lookup for staff search
-- (search/internal/options/portal-options.service.ts → idsByNumbers).
--
-- Every number a part carries, split ("A, B; C" lists) and normalized to
-- A-Z0-9: manufacturerPartNumber, every oeNumbers entry, and the
-- number-bearing listing aspects in itemSpecifics (interchange, superseded,
-- OE/OEM in en/de/fr/it/es). Without it a number inside a comma-joined
-- oeNumbers entry or only in itemSpecifics was unreachable, and the full
-- scan that would reach it takes ~5.5 s on 308k parts.
--
-- KEEP THE KEY LIST IN SYNC with ITEM_SPECIFIC_NUMBER_KEYS in
-- src/modules/search/internal/options/number-graph.ts.
-- Prisma cannot model an expression index; it lives only here.

CREATE OR REPLACE FUNCTION pb_part_numbers(mpn text, oe text[], specifics jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(array_agg(DISTINCT n), '{}'::text[])
  FROM (
    SELECT regexp_replace(upper(piece), '[^A-Z0-9]', '', 'g') AS n
    FROM (
      SELECT mpn AS v
      UNION ALL
      SELECT unnest(coalesce(oe, '{}'::text[]))
      UNION ALL
      SELECT specifics ->> k
      FROM unnest(ARRAY[
        'mpn', 'manufacturerPartNumber', 'numeroparteproduttore', 'officialArticleNumber',
        'oeNumber', 'oEPartNumber', 'OE_numbers', 'otherPartNumber',
        'numeroparteOE/OEM', 'numérodepièceOE/OEM', 'oE/OEMTeilenummer', 'númerodepiezaOE/OEM',
        'interchangePartNumber', 'interchangeNumbers', 'numeropartediscambio',
        'supersededPartNumber', 'supersedes', 'numeropartesostituito'
      ]) AS k
      WHERE jsonb_typeof(specifics) = 'object' AND jsonb_typeof(specifics -> k) = 'string'
      UNION ALL
      SELECT jsonb_array_elements_text(specifics -> k)
      FROM unnest(ARRAY[
        'mpn', 'manufacturerPartNumber', 'numeroparteproduttore', 'officialArticleNumber',
        'oeNumber', 'oEPartNumber', 'OE_numbers', 'otherPartNumber',
        'numeroparteOE/OEM', 'numérodepièceOE/OEM', 'oE/OEMTeilenummer', 'númerodepiezaOE/OEM',
        'interchangePartNumber', 'interchangeNumbers', 'numeropartediscambio',
        'supersededPartNumber', 'supersedes', 'numeropartesostituito'
      ]) AS k
      WHERE jsonb_typeof(specifics) = 'object' AND jsonb_typeof(specifics -> k) = 'array'
    ) raw,
    regexp_split_to_table(coalesce(raw.v, ''), E'[,;|\n\r]+') AS piece
  ) numbers
  WHERE length(n) >= 3 AND n ~ '[0-9]';
$$;

CREATE INDEX IF NOT EXISTS "CanonicalPart_part_numbers_gin"
  ON "CanonicalPart"
  USING gin (pb_part_numbers("manufacturerPartNumber", "oeNumbers", "itemSpecifics"));
