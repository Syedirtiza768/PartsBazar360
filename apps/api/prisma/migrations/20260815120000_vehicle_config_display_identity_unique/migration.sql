-- QA-03: unique buyer-visible identity for vehicle configurations.
--
-- Identity = generation + normalized display fields (trim/engine/transmission/
-- drivetrain/fuel), NULLs normalized to ''. `market` is provenance only and is
-- deliberately excluded: source-catalog rows (US vs GLOBAL) with identical
-- display fields are the same vehicle to a buyer, and keeping both split
-- fitments across indistinguishable rows (live: one Corolla generation
-- returned 52 vs 162 vs 165 parts depending on the duplicate row).
--
-- IMPORTANT: run `node scripts/dedupe-vehicle-configs.mjs` (then APPLY=1)
-- BEFORE applying this migration — the index build fails while duplicates
-- exist. The dedupe script's report lists exactly what would block it.
--
-- `resolveVehicleConfiguration` (vehicle-config-identity.util.ts) relies on
-- this index: a concurrent create that loses the race raises P2002 and the
-- resolver returns the winner's row.

CREATE UNIQUE INDEX "VehicleConfiguration_display_identity_key"
  ON "VehicleConfiguration" (
    "generationId",
    COALESCE(lower(btrim("trim")), ''),
    COALESCE(lower(btrim("engine")), ''),
    COALESCE(lower(btrim("transmission")), ''),
    COALESCE(lower(btrim("drivetrain")), ''),
    COALESCE(lower(btrim("fuel")), '')
  );
