-- Delete canonical parts that have ZERO offers (legacy K. Salvage residue ~140k).
-- CatalogPartNumber + ProductMedia cascade automatically. Fitment/FitmentEvidence
-- and CanonicalPartRedirect are deleted first (Restrict FKs). Nullable FKs
-- (SourceRecord/ReviewTask/AuditEvent/SupportTicket/SellerUploadRow) auto SetNull.
DO $$
DECLARE
  batch TEXT[];
BEGIN
  LOOP
    SELECT array_agg(id) INTO batch
    FROM (
      SELECT p.id
      FROM "CanonicalPart" p
      WHERE NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId" = p.id)
      LIMIT 5000
    ) t;
    IF batch IS NULL OR array_length(batch, 1) IS NULL THEN EXIT; END IF;

    DELETE FROM "FitmentEvidence"
      WHERE "fitmentId" IN (SELECT id FROM "Fitment" WHERE "canonicalPartId" = ANY(batch));
    DELETE FROM "Fitment" WHERE "canonicalPartId" = ANY(batch);
    DELETE FROM "CanonicalPartRedirect" WHERE "fromPartId" = ANY(batch) OR "toPartId" = ANY(batch);
    DELETE FROM "CanonicalPart" WHERE id = ANY(batch);

    RAISE NOTICE 'deleted batch of % parts', array_length(batch, 1);
  END LOOP;
END $$;

SELECT
  (SELECT COUNT(*) FROM "CanonicalPart") AS total_parts,
  (SELECT COUNT(*) FROM "CanonicalPart" p WHERE NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id)) AS zero_offer_parts_remaining;
