SELECT
  COUNT(*) FILTER (WHERE weight IS NULL OR weight <= 0) AS missing_or_zero_weight,
  COUNT(*) FILTER (WHERE weight > 0) AS has_weight,
  COUNT(*) AS total_parts
FROM "CanonicalPart";

WITH offer_stock AS (
  SELECT so.id,
         COALESCE(SUM(i.quantity), 0) AS qty,
         COUNT(i.id) AS inv_rows
  FROM "SellerOffer" so
  LEFT JOIN "Inventory" i ON i."offerId" = so.id
  WHERE so.status = 'ACTIVE'
  GROUP BY so.id
)
SELECT
  COUNT(*) AS active_offers,
  COUNT(*) FILTER (WHERE inv_rows = 0) AS no_inventory_rows,
  COUNT(*) FILTER (WHERE inv_rows > 0 AND qty = 0) AS zero_stock_with_inv,
  COUNT(*) FILTER (WHERE qty > 0) AS positive_stock
FROM offer_stock;
