-- Get all the part IDs that were deleted (for OpenSearch cleanup)
-- These are the 68 parts we deleted. We need their IDs to clean OpenSearch.
-- Since we already deleted them from CanonicalPart, we'll use the temp table approach.
-- But since that transaction committed, let's check what's in OpenSearch that shouldn't be.

-- FEBEST salvage parts that should NOT be in OpenSearch anymore
-- We need to find any CanonicalPart entries still in OS that have FEBEST in title 
-- but no active offers from any seller

SELECT p.id FROM "CanonicalPart" p
WHERE UPPER(COALESCE(p.brand, '')) LIKE '%FEBEST%'
  AND NOT EXISTS (
    SELECT 1 FROM "SellerOffer" o 
    WHERE o."canonicalPartId" = p.id AND o.status = 'ACTIVE'
  )
LIMIT 100;