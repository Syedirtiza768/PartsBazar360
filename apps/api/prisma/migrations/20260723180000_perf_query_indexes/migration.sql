-- Query-backed indexes for high-traffic merchant, cart, and fitment paths.
-- CREATE INDEX IF NOT EXISTS keeps this safe on hosts that already applied
-- equivalent ops SQL. CONCURRENTLY is not used so Prisma migrate can run
-- inside a transaction; apply CONCURRENTLY manually in production if needed.

CREATE INDEX IF NOT EXISTS "SellerOffer_sellerId_status_idx" ON "SellerOffer" ("sellerId", "status");
CREATE INDEX IF NOT EXISTS "SellerOffer_sellerId_updatedAt_idx" ON "SellerOffer" ("sellerId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Inventory_offerId_idx" ON "Inventory" ("offerId");
CREATE INDEX IF NOT EXISTS "Fitment_vehicleConfigId_idx" ON "Fitment" ("vehicleConfigId");
CREATE INDEX IF NOT EXISTS "Cart_userId_status_idx" ON "Cart" ("userId", "status");
CREATE INDEX IF NOT EXISTS "CartItem_cartId_idx" ON "CartItem" ("cartId");
CREATE INDEX IF NOT EXISTS "CartItem_sellerOfferId_idx" ON "CartItem" ("sellerOfferId");
CREATE INDEX IF NOT EXISTS "SellerOrder_sellerId_status_idx" ON "SellerOrder" ("sellerId", "status");
CREATE INDEX IF NOT EXISTS "SellerOrder_sellerId_createdAt_idx" ON "SellerOrder" ("sellerId", "createdAt");
CREATE INDEX IF NOT EXISTS "SellerOrder_parentOrderId_idx" ON "SellerOrder" ("parentOrderId");
