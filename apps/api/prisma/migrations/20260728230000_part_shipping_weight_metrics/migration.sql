-- Shipping weight accuracy: record where a weight came from, the resolved part
-- class, and the precomputed volumetric/billable weights used by quotes.
--
-- Before this, CanonicalPart.weight was the only shipping input and was almost
-- entirely null in production, so quotes fell back to a flat 1kg regardless of
-- part size. Volumetric weight was never considered at all.

ALTER TABLE "CanonicalPart"
  ADD COLUMN "weightSource"        TEXT,
  ADD COLUMN "weightConfidence"    DOUBLE PRECISION,
  ADD COLUMN "partClassKey"        TEXT,
  ADD COLUMN "dimensionalWeightKg" DOUBLE PRECISION,
  ADD COLUMN "billableWeightKg"    DOUBLE PRECISION,
  ADD COLUMN "enrichmentStatus"    TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "enrichmentVersion"   INTEGER NOT NULL DEFAULT 0;

-- Existing non-null weights predate source tracking. They came from seller
-- spreadsheets or manual ops backfills, so mark them as seller-supplied rather
-- than leaving them indistinguishable from future AI estimates.
UPDATE "CanonicalPart"
   SET "weightSource" = 'SELLER',
       "weightConfidence" = 0.6
 WHERE "weight" IS NOT NULL
   AND "weight" > 0;

-- Parts already enriched by an earlier campaign should not be re-queued.
UPDATE "CanonicalPart"
   SET "enrichmentStatus" = 'DONE'
 WHERE "enrichedAt" IS NOT NULL;

CREATE INDEX "CanonicalPart_enrichmentStatus_idx" ON "CanonicalPart"("enrichmentStatus");
CREATE INDEX "CanonicalPart_partClassKey_idx" ON "CanonicalPart"("partClassKey");
