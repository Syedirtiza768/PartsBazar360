SELECT COUNT(*) AS dup_ebay
FROM (
  SELECT "ebayItemId" FROM "CanonicalPart"
  WHERE "ebayItemId" IS NOT NULL AND "ebayItemId" <> ''
  GROUP BY 1 HAVING COUNT(*) > 1
) t;

SELECT COUNT(*) AS dup_ext
FROM (
  SELECT "externalOfferId" FROM "SellerOffer"
  WHERE "externalOfferId" IS NOT NULL AND "externalOfferId" <> ''
  GROUP BY 1 HAVING COUNT(*) > 1
) t;
