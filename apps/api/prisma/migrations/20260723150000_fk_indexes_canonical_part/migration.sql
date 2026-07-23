-- Add missing FK indexes on canonicalPartId for tables that reference CanonicalPart.
-- These speed up FK validation when deleting CanonicalPart rows (without them,
-- every part delete full-scans the large SellerOffer table). Idempotent so it is
-- safe on environments where the indexes were already created by an ops script.
CREATE INDEX IF NOT EXISTS "SellerOffer_canonicalPartId_idx" ON "SellerOffer" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SalvageUnit_canonicalPartId_idx" ON "SalvageUnit" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SourceRecord_canonicalPartId_idx" ON "SourceRecord" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "ReviewTask_canonicalPartId_idx" ON "ReviewTask" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SellerUploadRow_canonicalPartId_idx" ON "SellerUploadRow" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SupportTicket_canonicalPartId_idx" ON "SupportTicket" ("canonicalPartId");
