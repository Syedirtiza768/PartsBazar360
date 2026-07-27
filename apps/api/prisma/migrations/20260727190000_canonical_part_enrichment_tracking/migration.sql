-- Track item-specifics enrichment on CanonicalPart.
-- Two nullable columns so existing rows / non-enriched parts are unaffected.
-- Backfill stamps the rows that already have itemSpecifics (3,327 at time of
-- writing) so historical enrichment is trackable: enrichedAt = updatedAt, and
-- enrichmentSource inferred from brand/compatibility (FEBEST vs the Toyota/
-- BMW/Dodge LLM runs).

ALTER TABLE "CanonicalPart" ADD COLUMN IF NOT EXISTS "enrichedAt" TIMESTAMP(3);
ALTER TABLE "CanonicalPart" ADD COLUMN IF NOT EXISTS "enrichmentSource" TEXT;

-- Backfill historical enrichment. Only rows with itemSpecifics are touched.
UPDATE "CanonicalPart"
SET "enrichedAt" = "updatedAt",
    "enrichmentSource" = CASE
      WHEN "brand" = 'FEBEST' THEN 'llm:mimo:febest'
      WHEN "compatibility" IS NOT NULL
           AND jsonb_path_exists(
                 "compatibility",
                 '$[*].make ? (@ == "Toyota" || @ == "TOYOTA")'
               ) THEN 'llm:mimo:toyota'
      WHEN "compatibility" IS NOT NULL
           AND jsonb_path_exists(
                 "compatibility",
                 '$[*].make ? (@ == "BMW")'
               ) THEN 'llm:mimo:bmw'
      WHEN "compatibility" IS NOT NULL
           AND jsonb_path_exists(
                 "compatibility",
                 '$[*].make ? (@ == "Dodge")'
               ) THEN 'llm:mimo:dodge'
      ELSE 'llm:mimo'
    END
WHERE "itemSpecifics" IS NOT NULL
  AND "enrichedAt" IS NULL;
