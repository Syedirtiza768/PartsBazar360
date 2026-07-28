DROP TABLE IF EXISTS tmp_stale_part_ids;
CREATE TABLE tmp_stale_part_ids AS
SELECT p.id
FROM "CanonicalPart" p
WHERE NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = p.id);
CREATE INDEX ON tmp_stale_part_ids (id);
SELECT COUNT(*) AS stale_to_delete FROM tmp_stale_part_ids;
