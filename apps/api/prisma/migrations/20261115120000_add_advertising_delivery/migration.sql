CREATE TABLE "AdvertisingConsent" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AdvertisingConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdvertisingConsent_expiresAt_idx" ON "AdvertisingConsent"("expiresAt");

CREATE TABLE "AdvertisingCheckout" (
    "checkoutId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "attribution" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdvertisingCheckout_pkey" PRIMARY KEY ("checkoutId")
);
CREATE INDEX "AdvertisingCheckout_expiresAt_idx" ON "AdvertisingCheckout"("expiresAt");

CREATE TABLE "AdvertisingDelivery" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" JSONB NOT NULL,
    "attribution" JSONB NOT NULL,
    "consentId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "result" TEXT,
    CONSTRAINT "AdvertisingDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdvertisingDelivery_vendor_eventId_key" ON "AdvertisingDelivery"("vendor", "eventId");
CREATE INDEX "AdvertisingDelivery_finishedAt_nextAttemptAt_idx" ON "AdvertisingDelivery"("finishedAt", "nextAttemptAt");
