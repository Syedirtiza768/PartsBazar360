CREATE TABLE "DiscountCoupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiscountCoupon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscountCoupon_code_key" ON "DiscountCoupon"("code");
CREATE INDEX "DiscountCoupon_active_startsAt_endsAt_idx"
  ON "DiscountCoupon"("active", "startsAt", "endsAt");

ALTER TABLE "Order"
  ADD COLUMN "couponId" TEXT,
  ADD COLUMN "couponCode" TEXT,
  ADD COLUMN "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "SellerOrder"
  ADD COLUMN "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_couponId_fkey"
  FOREIGN KEY ("couponId") REFERENCES "DiscountCoupon"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_couponId_idx" ON "Order"("couponId");