CREATE TEMP TABLE batch_ids AS SELECT id FROM tmp_stale_part_ids LIMIT 5000;
DELETE FROM "FitmentEvidence" WHERE "fitmentId" IN (SELECT id FROM "Fitment" WHERE "canonicalPartId" IN (SELECT id FROM batch_ids));
DELETE FROM "Fitment" WHERE "canonicalPartId" IN (SELECT id FROM batch_ids);
DELETE FROM "CanonicalPartRedirect" WHERE "fromPartId" IN (SELECT id FROM batch_ids) OR "toPartId" IN (SELECT id FROM batch_ids);
DELETE FROM "CanonicalPart" WHERE id IN (SELECT id FROM batch_ids);
DELETE FROM tmp_stale_part_ids WHERE id IN (SELECT id FROM batch_ids);
SELECT COUNT(*) AS remaining FROM tmp_stale_part_ids;
