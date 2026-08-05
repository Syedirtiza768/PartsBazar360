-- Dry run: for CanonicalPart rows currently marked GENUINE_OEM or
-- UNCLASSIFIED, check what BrandMaster says about their (now-corrected)
-- brand and report how many would actually be AFTERMARKET. Read-only —
-- no UPDATEs. Mirrors the same isAftermarketBrand/suppliesGenuineOem/
-- isVehicleManufacturer decision now wired into classifyPart().

SELECT
  cp."partType" AS current_part_type,
  bm."isVehicleManufacturer",
  bm."isAftermarketBrand",
  bm."suppliesGenuineOem",
  CASE
    WHEN bm."isAftermarketBrand" AND NOT bm."suppliesGenuineOem" AND NOT bm."isVehicleManufacturer"
      THEN 'AFTERMARKET (high confidence)'
    WHEN bm."isAftermarketBrand" AND (bm."suppliesGenuineOem" OR bm."isVehicleManufacturer")
      THEN 'UNCLASSIFIED (dual-role brand, needs evidence)'
    WHEN bm.id IS NULL
      THEN 'no BrandMaster match — leave as-is'
    ELSE 'no change'
  END AS proposed_action,
  count(*)
FROM "CanonicalPart" cp
LEFT JOIN "BrandMaster" bm
  ON bm.status = 'ACTIVE'
  AND (
    upper(trim(bm."canonicalName")) = upper(trim(cp.brand))
    OR bm.id = cp."primaryBrandId"
  )
WHERE cp."partType" IN ('GENUINE_OEM', 'UNCLASSIFIED')
GROUP BY 1,2,3,4,5
ORDER BY 6 DESC;
