-- Optional staff-set fixed shipping charge per listing (AED, per unit).
-- NULL keeps the weight/destination quote; 0 means free shipping.
ALTER TABLE "SellerOffer" ADD COLUMN "shippingCost" DOUBLE PRECISION;
