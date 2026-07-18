-- Catalog governance spine: fitment evidence, review tasks, audit, redirects, staging fields, search outbox

ALTER TABLE "Fitment" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "Fitment" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "Fitment" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "Fitment" ADD COLUMN IF NOT EXISTS "fitmentNotes" TEXT;
ALTER TABLE "Fitment" ADD COLUMN IF NOT EXISTS "originalData" JSONB;
ALTER TABLE "Fitment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "FitmentEvidence" (
    "id" TEXT NOT NULL,
    "fitmentId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceLevel" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT,
    "sourceRecordId" TEXT,
    "originalValue" JSONB,
    "normalizedValue" JSONB,
    "reason" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FitmentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FitmentEvidence_fitmentId_evidenceType_idx" ON "FitmentEvidence"("fitmentId", "evidenceType");

DO $$ BEGIN
  ALTER TABLE "FitmentEvidence" ADD CONSTRAINT "FitmentEvidence_fitmentId_fkey"
    FOREIGN KEY ("fitmentId") REFERENCES "Fitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "SellerUploadJob" ADD COLUMN IF NOT EXISTS "commitMode" TEXT NOT NULL DEFAULT 'IMMEDIATE';
ALTER TABLE "SellerUploadJob" ADD COLUMN IF NOT EXISTS "catalogType" TEXT;
ALTER TABLE "SellerUploadJob" ADD COLUMN IF NOT EXISTS "preview" JSONB;
ALTER TABLE "SellerUploadJob" ADD COLUMN IF NOT EXISTS "detection" JSONB;

ALTER TABLE "SellerUploadRow" ADD COLUMN IF NOT EXISTS "matchCandidateId" TEXT;
ALTER TABLE "SellerUploadRow" ADD COLUMN IF NOT EXISTS "matchExplanation" JSONB;
ALTER TABLE "SellerUploadRow" ADD COLUMN IF NOT EXISTS "suggestedPartType" TEXT;
ALTER TABLE "SellerUploadRow" ADD COLUMN IF NOT EXISTS "stagedPayload" JSONB;

CREATE INDEX IF NOT EXISTS "SellerUploadRow_status_idx" ON "SellerUploadRow"("status");

CREATE TABLE IF NOT EXISTS "CanonicalPartRedirect" (
    "id" TEXT NOT NULL,
    "fromPartId" TEXT NOT NULL,
    "toPartId" TEXT NOT NULL,
    "reason" TEXT,
    "mergedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalPartRedirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CanonicalPartRedirect_fromPartId_key" ON "CanonicalPartRedirect"("fromPartId");
CREATE INDEX IF NOT EXISTS "CanonicalPartRedirect_toPartId_idx" ON "CanonicalPartRedirect"("toPartId");

DO $$ BEGIN
  ALTER TABLE "CanonicalPartRedirect" ADD CONSTRAINT "CanonicalPartRedirect_fromPartId_fkey"
    FOREIGN KEY ("fromPartId") REFERENCES "CanonicalPart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CanonicalPartRedirect" ADD CONSTRAINT "CanonicalPartRedirect_toPartId_fkey"
    FOREIGN KEY ("toPartId") REFERENCES "CanonicalPart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ReviewTask" (
    "id" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "sellerId" TEXT,
    "uploadJobId" TEXT,
    "canonicalPartId" TEXT,
    "payload" JSONB,
    "confidence" DOUBLE PRECISION,
    "assignedTo" TEXT,
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReviewTask_queueType_status_idx" ON "ReviewTask"("queueType", "status");
CREATE INDEX IF NOT EXISTS "ReviewTask_sellerId_status_idx" ON "ReviewTask"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "ReviewTask_uploadJobId_idx" ON "ReviewTask"("uploadJobId");

DO $$ BEGIN
  ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_uploadJobId_fkey"
    FOREIGN KEY ("uploadJobId") REFERENCES "SellerUploadJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_canonicalPartId_fkey"
    FOREIGN KEY ("canonicalPartId") REFERENCES "CanonicalPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "source" TEXT,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "originalValue" JSONB,
    "normalizedValue" JSONB,
    "metadata" JSONB,
    "canonicalPartId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_canonicalPartId_idx" ON "AuditEvent"("canonicalPartId");

DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_canonicalPartId_fkey"
    FOREIGN KEY ("canonicalPartId") REFERENCES "CanonicalPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "SearchOutbox" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'CanonicalPart',
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'UPSERT',
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SearchOutbox_status_availableAt_idx" ON "SearchOutbox"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "SearchOutbox_entityId_idx" ON "SearchOutbox"("entityId");
