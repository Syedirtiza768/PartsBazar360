-- Guest-first checkout identity. This migration is intentionally additive:
-- legacy User/Order/PaymentIntent fields remain available during rollout.

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Customer_phoneNormalized_key" ON "Customer"("phoneNormalized");

ALTER TABLE "User" ADD COLUMN "customerId" TEXT;
CREATE UNIQUE INDEX "User_customerId_key" ON "User"("customerId");

-- Existing verified buyer rows become commerce identities. Reusing the User
-- UUID makes this backfill deterministic and avoids database UUID extensions.
INSERT INTO "Customer" (
  "id", "phoneNormalized", "phoneVerifiedAt", "name", "email", "createdAt", "updatedAt"
)
SELECT
  u."id",
  btrim(u."phone"),
  u."updatedAt",
  u."name",
  u."email",
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."phoneVerified" = true
  AND u."phone" IS NOT NULL
  AND btrim(u."phone") ~ '^\+[1-9][0-9]{7,14}$'
ON CONFLICT ("phoneNormalized") DO NOTHING;

UPDATE "User" u
SET "customerId" = c."id"
FROM "Customer" c
-- Only the User row selected as the canonical Customer receives the one-to-one
-- account link. Duplicate verified phone rows remain unlinked for the preflight
-- reconciliation report instead of making this migration fail its unique key.
WHERE u."id" = c."id"
  AND u."phoneVerified" = true;

ALTER TABLE "User"
  ADD CONSTRAINT "User_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "customerId" TEXT,
    "phoneNormalized" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "checkoutTokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "draft" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckoutSession_cartId_status_idx" ON "CheckoutSession"("cartId", "status");
CREATE INDEX "CheckoutSession_phoneNormalized_createdAt_idx" ON "CheckoutSession"("phoneNormalized", "createdAt");

ALTER TABLE "CheckoutSession"
  ADD CONSTRAINT "CheckoutSession_cartId_fkey"
  FOREIGN KEY ("cartId") REFERENCES "Cart"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutSession"
  ADD CONSTRAINT "CheckoutSession_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PhoneVerificationChallenge" (
    "id" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "requestIpHash" TEXT,
    "deviceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PhoneVerificationChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PhoneVerificationChallenge_checkoutSessionId_createdAt_idx"
  ON "PhoneVerificationChallenge"("checkoutSessionId", "createdAt");
CREATE INDEX "PhoneVerificationChallenge_phoneNormalized_createdAt_idx"
  ON "PhoneVerificationChallenge"("phoneNormalized", "createdAt");
CREATE INDEX "PhoneVerificationChallenge_requestIpHash_createdAt_idx"
  ON "PhoneVerificationChallenge"("requestIpHash", "createdAt");

ALTER TABLE "PhoneVerificationChallenge"
  ADD CONSTRAINT "PhoneVerificationChallenge_checkoutSessionId_fkey"
  FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CheckoutEvent" (
    "id" TEXT NOT NULL,
    "checkoutSessionId" TEXT,
    "name" TEXT NOT NULL,
    "deviceClass" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckoutEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckoutEvent_name_createdAt_idx" ON "CheckoutEvent"("name", "createdAt");
CREATE INDEX "CheckoutEvent_checkoutSessionId_createdAt_idx"
  ON "CheckoutEvent"("checkoutSessionId", "createdAt");

ALTER TABLE "CheckoutEvent"
  ADD CONSTRAINT "CheckoutEvent_checkoutSessionId_fkey"
  FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "checkoutSessionId" TEXT,
  ADD COLUMN "verifiedPhone" TEXT,
  ADD COLUMN "idempotencyKey" TEXT;

UPDATE "Order" o
SET "customerId" = c."id",
    "verifiedPhone" = c."phoneNormalized"
FROM "User" u
JOIN "Customer" c ON btrim(u."phone") = c."phoneNormalized"
WHERE o."buyerId" = u."id"
  AND u."phoneVerified" = true;

CREATE UNIQUE INDEX "Order_checkoutSessionId_key" ON "Order"("checkoutSessionId");
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_checkoutSessionId_fkey"
  FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "checkoutUrl" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentAttempt_externalId_key" ON "PaymentAttempt"("externalId");
CREATE INDEX "PaymentAttempt_paymentIntentId_createdAt_idx"
  ON "PaymentAttempt"("paymentIntentId", "createdAt");

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
