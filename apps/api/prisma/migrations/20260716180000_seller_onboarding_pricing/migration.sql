-- Seller onboarding and commercial profile
ALTER TABLE "Seller"
  ADD COLUMN "onboardingStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "onboardingNotes" TEXT,
  ADD COLUMN "activatedAt" TIMESTAMP(3);

-- Preserve the current imported sellers as active; newly created sellers remain DRAFT.
UPDATE "Seller" SET "onboardingStatus" = 'ACTIVE', "activatedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "SellerProfile" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "accountType" TEXT NOT NULL DEFAULT 'BUSINESS',
  "legalName" TEXT,
  "tradingName" TEXT,
  "registrationNumber" TEXT,
  "taxId" TEXT,
  "website" TEXT,
  "phone" TEXT,
  "supportEmail" TEXT,
  "country" TEXT,
  "address" JSONB,
  "complianceStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "payoutStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "fulfillmentSlaHours" INTEGER NOT NULL DEFAULT 48,
  "returnWindowDays" INTEGER NOT NULL DEFAULT 30,
  "acceptsReturns" BOOLEAN NOT NULL DEFAULT true,
  "warrantyDays" INTEGER NOT NULL DEFAULT 0,
  "supportedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "supportedConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "shippingRegions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "freightCapable" BOOLEAN NOT NULL DEFAULT false,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerProfile_sellerId_key" ON "SellerProfile"("sellerId");
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SellerAgreementAcceptance" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "agreementType" TEXT NOT NULL,
  "agreementVersion" TEXT NOT NULL,
  "acceptedByEmail" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "SellerAgreementAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerAgreementAcceptance_sellerId_agreementType_agreementVersion_key"
  ON "SellerAgreementAcceptance"("sellerId", "agreementType", "agreementVersion");
ALTER TABLE "SellerAgreementAcceptance" ADD CONSTRAINT "SellerAgreementAcceptance_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PricingPolicy" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "mode" TEXT NOT NULL,
  "percentRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fixedFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "category" TEXT,
  "minimumPrice" DOUBLE PRECISION,
  "maximumFee" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "terms" JSONB,
  "createdBy" TEXT,
  "approvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PricingPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PricingPolicy_code_version_key" ON "PricingPolicy"("code", "version");

CREATE TABLE "SellerPricingAssignment" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "pricingPolicyId" TEXT NOT NULL,
  "category" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerPricingAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SellerPricingAssignment_sellerId_category_status_idx"
  ON "SellerPricingAssignment"("sellerId", "category", "status");
ALTER TABLE "SellerPricingAssignment" ADD CONSTRAINT "SellerPricingAssignment_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerPricingAssignment" ADD CONSTRAINT "SellerPricingAssignment_pricingPolicyId_fkey"
  FOREIGN KEY ("pricingPolicyId") REFERENCES "PricingPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Offer-level commercial calculations
ALTER TABLE "SellerOffer"
  ADD COLUMN "sellerBasePrice" DOUBLE PRECISION,
  ADD COLUMN "marketplaceFee" DOUBLE PRECISION,
  ADD COLUMN "sellerProceeds" DOUBLE PRECISION,
  ADD COLUMN "pricingPolicyId" TEXT,
  ADD COLUMN "pricingPolicyVersion" INTEGER,
  ADD COLUMN "pricedAt" TIMESTAMP(3);

ALTER TABLE "SellerOffer" ADD CONSTRAINT "SellerOffer_pricingPolicyId_fkey"
  FOREIGN KEY ("pricingPolicyId") REFERENCES "PricingPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Immutable commercial snapshot captured at checkout
ALTER TABLE "SellerOrder"
  ADD COLUMN "marketplaceFeeTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "sellerProceedsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ALTER COLUMN "status" SET DEFAULT 'AWAITING_PAYMENT';

ALTER TABLE "OrderItem"
  ADD COLUMN "sellerBaseUnitPrice" DOUBLE PRECISION,
  ADD COLUMN "marketplaceFeeUnit" DOUBLE PRECISION,
  ADD COLUMN "sellerProceedsUnit" DOUBLE PRECISION,
  ADD COLUMN "pricingPolicyId" TEXT,
  ADD COLUMN "pricingPolicyVersion" INTEGER;

