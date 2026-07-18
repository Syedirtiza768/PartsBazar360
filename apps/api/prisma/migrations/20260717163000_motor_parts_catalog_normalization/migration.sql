-- Additive catalog normalization foundation. Legacy fields remain in place so
-- existing buyer/search code can be migrated without a flag day.
ALTER TABLE "Warehouse" ADD COLUMN "externalKey" TEXT;
CREATE UNIQUE INDEX "Warehouse_sellerId_externalKey_key" ON "Warehouse"("sellerId", "externalKey");

ALTER TABLE "CanonicalPart"
  ADD COLUMN "normalizedTitle" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "partType" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  ADD COLUMN "primaryBrandId" TEXT,
  ADD COLUMN "manufacturerPartNumber" TEXT,
  ADD COLUMN "genuineOemPartNumber" TEXT,
  ADD COLUMN "dimensions" JSONB,
  ADD COLUMN "position" TEXT,
  ADD COLUMN "vehicleSystem" TEXT,
  ADD COLUMN "classificationStatus" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
  ADD COLUMN "classificationConfidence" DOUBLE PRECISION,
  ADD COLUMN "classificationReason" TEXT,
  ADD COLUMN "completenessScore" DOUBLE PRECISION,
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED';

ALTER TABLE "SellerOffer"
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "sellerSku" TEXT,
  ADD COLUMN "sellerTitle" TEXT,
  ADD COLUMN "partType" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  ADD COLUMN "moq" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "leadTimeDays" INTEGER,
  ADD COLUMN "deliveryMethod" TEXT,
  ADD COLUMN "warranty" TEXT,
  ADD COLUMN "returnPolicy" TEXT,
  ADD COLUMN "sellerNotes" TEXT;
CREATE UNIQUE INDEX "SellerOffer_sourceKey_key" ON "SellerOffer"("sourceKey");

ALTER TABLE "VehicleMake"
  ADD COLUMN "canonicalName" TEXT,
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "manufacturerGroup" TEXT,
  ADD COLUMN "regionalNames" JSONB,
  ADD COLUMN "externalIds" JSONB;

ALTER TABLE "Fitment"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "fitmentNotes" TEXT,
  ADD COLUMN "originalData" JSONB;

ALTER TABLE "SellerUploadJob"
  ADD COLUMN "fileChecksum" TEXT,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "sourceSheet" TEXT,
  ADD COLUMN "mapping" JSONB,
  ADD COLUMN "defaultBrand" TEXT,
  ADD COLUMN "defaultCurrency" TEXT,
  ADD COLUMN "defaultDimensionUnit" TEXT,
  ADD COLUMN "defaultWeightUnit" TEXT,
  ADD COLUMN "report" JSONB;
CREATE UNIQUE INDEX "SellerUploadJob_sellerId_fileChecksum_key" ON "SellerUploadJob"("sellerId", "fileChecksum");

ALTER TABLE "SellerUploadRow"
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "normalizedData" JSONB,
  ADD COLUMN "classificationConfidence" DOUBLE PRECISION,
  ADD COLUMN "classificationReason" TEXT,
  ADD COLUMN "matchConfidence" DOUBLE PRECISION;

CREATE TABLE "SellerSourceAccount" (
  "id" TEXT NOT NULL, "sellerId" TEXT NOT NULL, "sourcePlatform" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL, "marketplace" TEXT, "username" TEXT,
  "storeUrl" TEXT, "metadata" JSONB, "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerSourceAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellerSourceAccount_sourcePlatform_externalAccountId_key" ON "SellerSourceAccount"("sourcePlatform", "externalAccountId");

CREATE TABLE "BrandMaster" (
  "id" TEXT NOT NULL, "canonicalName" TEXT NOT NULL, "displayName" TEXT NOT NULL,
  "brandTypes" TEXT[] DEFAULT ARRAY[]::TEXT[], "parentGroup" TEXT, "logoUrl" TEXT,
  "country" TEXT, "officialWebsite" TEXT, "isVehicleManufacturer" BOOLEAN NOT NULL DEFAULT false,
  "isAftermarketBrand" BOOLEAN NOT NULL DEFAULT false, "suppliesGenuineOem" BOOLEAN NOT NULL DEFAULT false,
  "requiresManualReview" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrandMaster_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrandMaster_canonicalName_key" ON "BrandMaster"("canonicalName");

CREATE TABLE "BrandAlias" (
  "id" TEXT NOT NULL, "brandId" TEXT NOT NULL, "alias" TEXT NOT NULL, "normalized" TEXT NOT NULL,
  "source" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrandAlias_brandId_normalized_key" ON "BrandAlias"("brandId", "normalized");
CREATE INDEX "BrandAlias_normalized_idx" ON "BrandAlias"("normalized");

CREATE TABLE "VehicleMakeAlias" (
  "id" TEXT NOT NULL, "vehicleMakeId" TEXT NOT NULL, "alias" TEXT NOT NULL,
  "normalized" TEXT NOT NULL, "region" TEXT, "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleMakeAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VehicleMakeAlias_normalized_key" ON "VehicleMakeAlias"("normalized");

CREATE TABLE "CatalogPartNumber" (
  "id" TEXT NOT NULL, "canonicalPartId" TEXT NOT NULL, "displayNumber" TEXT NOT NULL,
  "normalizedNumber" TEXT NOT NULL, "numberType" TEXT NOT NULL, "brandId" TEXT,
  "vehicleMakeId" TEXT, "source" TEXT NOT NULL, "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogPartNumber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogPartNumber_identity_key" ON "CatalogPartNumber"("canonicalPartId", "numberType", "normalizedNumber", "brandId", "vehicleMakeId");
CREATE INDEX "CatalogPartNumber_normalizedNumber_idx" ON "CatalogPartNumber"("normalizedNumber");
CREATE INDEX "CatalogPartNumber_vehicleMakeId_normalizedNumber_idx" ON "CatalogPartNumber"("vehicleMakeId", "normalizedNumber");

CREATE TABLE "ProductMedia" (
  "id" TEXT NOT NULL, "canonicalPartId" TEXT NOT NULL, "url" TEXT NOT NULL,
  "normalizedUrl" TEXT NOT NULL, "sourceUrl" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false, "isActualItem" BOOLEAN NOT NULL DEFAULT false,
  "mediaType" TEXT NOT NULL DEFAULT 'IMAGE', "importStatus" TEXT NOT NULL DEFAULT 'IMPORTED',
  "altText" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductMedia_canonicalPartId_normalizedUrl_key" ON "ProductMedia"("canonicalPartId", "normalizedUrl");

CREATE TABLE "OfferPrice" (
  "id" TEXT NOT NULL, "offerId" TEXT NOT NULL, "currency" TEXT NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL, "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "exchangeRate" DECIMAL(18,8), "rateSource" TEXT, "quotedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfferPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OfferPrice_offerId_currency_key" ON "OfferPrice"("offerId", "currency");

CREATE TABLE "DonorVehicle" (
  "id" TEXT NOT NULL, "makeId" TEXT, "model" TEXT, "modelYear" INTEGER, "trim" TEXT,
  "engine" TEXT, "engineCode" TEXT, "transmission" TEXT, "vinMasked" TEXT, "vinHash" TEXT,
  "mileage" INTEGER, "mileageUnit" TEXT, "donorStockNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DonorVehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalvageUnit" (
  "id" TEXT NOT NULL, "canonicalPartId" TEXT NOT NULL, "sellerOfferId" TEXT NOT NULL,
  "donorVehicleId" TEXT, "originalOemNumber" TEXT, "conditionGrade" TEXT, "testedStatus" TEXT,
  "damageNotes" TEXT, "missingComponents" TEXT[] DEFAULT ARRAY[]::TEXT[], "warranty" TEXT,
  "dismantlingLocation" TEXT, "shelfBin" TEXT, "identityMethod" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalvageUnit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalvageUnit_sellerOfferId_key" ON "SalvageUnit"("sellerOfferId");

CREATE TABLE "SourceRecord" (
  "id" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "sourcePlatform" TEXT, "sellerId" TEXT,
  "sellerSourceAccountId" TEXT, "canonicalPartId" TEXT, "sellerOfferId" TEXT, "externalId" TEXT,
  "sourceFileName" TEXT, "sourceSheet" TEXT, "sourceRowNumber" INTEGER, "sourceKey" TEXT NOT NULL,
  "rawPayload" JSONB NOT NULL, "transformations" JSONB, "matchConfidence" DOUBLE PRECISION,
  "classificationConfidence" DOUBLE PRECISION, "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3), CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceRecord_sourceKey_key" ON "SourceRecord"("sourceKey");

CREATE UNIQUE INDEX "Inventory_warehouseId_offerId_key" ON "Inventory"("warehouseId", "offerId");

ALTER TABLE "SellerSourceAccount" ADD CONSTRAINT "SellerSourceAccount_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrandAlias" ADD CONSTRAINT "BrandAlias_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleMakeAlias" ADD CONSTRAINT "VehicleMakeAlias_vehicleMakeId_fkey" FOREIGN KEY ("vehicleMakeId") REFERENCES "VehicleMake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanonicalPart" ADD CONSTRAINT "CanonicalPart_primaryBrandId_fkey" FOREIGN KEY ("primaryBrandId") REFERENCES "BrandMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogPartNumber" ADD CONSTRAINT "CatalogPartNumber_canonicalPartId_fkey" FOREIGN KEY ("canonicalPartId") REFERENCES "CanonicalPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogPartNumber" ADD CONSTRAINT "CatalogPartNumber_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogPartNumber" ADD CONSTRAINT "CatalogPartNumber_vehicleMakeId_fkey" FOREIGN KEY ("vehicleMakeId") REFERENCES "VehicleMake"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_canonicalPartId_fkey" FOREIGN KEY ("canonicalPartId") REFERENCES "CanonicalPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferPrice" ADD CONSTRAINT "OfferPrice_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SellerOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DonorVehicle" ADD CONSTRAINT "DonorVehicle_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "VehicleMake"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalvageUnit" ADD CONSTRAINT "SalvageUnit_canonicalPartId_fkey" FOREIGN KEY ("canonicalPartId") REFERENCES "CanonicalPart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalvageUnit" ADD CONSTRAINT "SalvageUnit_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalvageUnit" ADD CONSTRAINT "SalvageUnit_donorVehicleId_fkey" FOREIGN KEY ("donorVehicleId") REFERENCES "DonorVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_sellerSourceAccountId_fkey" FOREIGN KEY ("sellerSourceAccountId") REFERENCES "SellerSourceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_canonicalPartId_fkey" FOREIGN KEY ("canonicalPartId") REFERENCES "CanonicalPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "SellerOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
