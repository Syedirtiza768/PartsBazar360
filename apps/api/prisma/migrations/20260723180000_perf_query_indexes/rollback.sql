-- Rollback for 20260723180000_perf_query_indexes
DROP INDEX IF EXISTS "SellerOffer_sellerId_status_idx";
DROP INDEX IF EXISTS "SellerOffer_sellerId_updatedAt_idx";
DROP INDEX IF EXISTS "Inventory_offerId_idx";
DROP INDEX IF EXISTS "Fitment_vehicleConfigId_idx";
DROP INDEX IF EXISTS "Cart_userId_status_idx";
DROP INDEX IF EXISTS "CartItem_cartId_idx";
DROP INDEX IF EXISTS "CartItem_sellerOfferId_idx";
DROP INDEX IF EXISTS "SellerOrder_sellerId_status_idx";
DROP INDEX IF EXISTS "SellerOrder_sellerId_createdAt_idx";
DROP INDEX IF EXISTS "SellerOrder_parentOrderId_idx";
