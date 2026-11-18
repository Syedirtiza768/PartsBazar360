-- Listing fields that RealTrack feed syncs must not overwrite (staff-repaired
-- text). A constant default makes this a metadata-only change on Postgres 11+.
ALTER TABLE "CanonicalPart" ADD COLUMN IF NOT EXISTS "feedLockedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
