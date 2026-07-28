-- Infographic content for high-value parts.
--
-- Stores the generated *content*, not a rendered image: the SVG is templated on
-- demand from this spec, so changing the design is a deploy rather than a batch
-- re-render, and never costs another LLM call.
ALTER TABLE "CanonicalPart"
  ADD COLUMN IF NOT EXISTS "infographicSpec" JSONB,
  ADD COLUMN IF NOT EXISTS "infographicVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "infographicGeneratedAt" TIMESTAMP(3);

-- Lets the worker find parts still awaiting an infographic without scanning the
-- whole catalog. Partial, because the overwhelming majority never qualify.
CREATE INDEX IF NOT EXISTS "CanonicalPart_infographicVersion_idx"
  ON "CanonicalPart" ("infographicVersion")
  WHERE "infographicSpec" IS NOT NULL;
