ALTER TABLE "CartItem"
ADD COLUMN "intendedVehicleConfigId" TEXT,
ADD COLUMN "purchaseIntent" TEXT NOT NULL DEFAULT 'UNSPECIFIED';

CREATE INDEX "CartItem_intendedVehicleConfigId_idx"
ON "CartItem"("intendedVehicleConfigId");

ALTER TABLE "CartItem"
ADD CONSTRAINT "CartItem_intendedVehicleConfigId_fkey"
FOREIGN KEY ("intendedVehicleConfigId")
REFERENCES "VehicleConfiguration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD COLUMN "checkoutValidationSnapshot" JSONB;

ALTER TABLE "SellerOrder"
ADD COLUMN "shippingQuoteSnapshot" JSONB;

ALTER TABLE "OrderItem"
ADD COLUMN "lineSnapshot" JSONB,
ADD COLUMN "decisionSnapshot" JSONB;

ALTER TABLE "PaymentAttempt"
ADD COLUMN "validationSnapshot" JSONB;

CREATE TABLE "CheckoutValidation" (
  "id" TEXT NOT NULL,
  "cartId" TEXT NOT NULL,
  "checkoutSessionId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutValidation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckoutValidation_cartId_createdAt_idx"
ON "CheckoutValidation"("cartId", "createdAt");

CREATE INDEX "CheckoutValidation_checkoutSessionId_expiresAt_idx"
ON "CheckoutValidation"("checkoutSessionId", "expiresAt");

CREATE INDEX "CheckoutValidation_expiresAt_consumedAt_idx"
ON "CheckoutValidation"("expiresAt", "consumedAt");

ALTER TABLE "CheckoutValidation"
ADD CONSTRAINT "CheckoutValidation_cartId_fkey"
FOREIGN KEY ("cartId")
REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckoutValidation"
ADD CONSTRAINT "CheckoutValidation_checkoutSessionId_fkey"
FOREIGN KEY ("checkoutSessionId")
REFERENCES "CheckoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
