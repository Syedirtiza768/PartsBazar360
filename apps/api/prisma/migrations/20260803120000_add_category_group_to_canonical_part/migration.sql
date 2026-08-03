-- Broader grouping over CanonicalPart.category (e.g. "Transmission", "Electrical"),
-- populated by the granular-category classification pass. Nullable so existing
-- rows are unaffected until the backfill script runs.

ALTER TABLE "CanonicalPart" ADD COLUMN IF NOT EXISTS "categoryGroup" TEXT;
