-- Clear stale infographic specs for Superior Auto Parts.
-- The /infographic.svg endpoint now falls back to rendering from DB fields
-- (condition, position, category, etc.) when infographicSpec is NULL.

UPDATE "CanonicalPart" cp
SET
  "infographicSpec"       = NULL,
  "infographicVersion"    = 0,
  "infographicGeneratedAt" = NULL
WHERE cp."id" IN (
  SELECT DISTINCT so."canonicalPartId"
  FROM "SellerOffer" so
  JOIN "Seller" s ON s."id" = so."sellerId"
  WHERE s."name" = 'Superior Auto Parts'
    AND so."status" = 'ACTIVE'
);
