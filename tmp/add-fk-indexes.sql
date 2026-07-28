CREATE INDEX IF NOT EXISTS "SellerOffer_canonicalPartId_idx" ON "SellerOffer" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SalvageUnit_canonicalPartId_idx" ON "SalvageUnit" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SourceRecord_canonicalPartId_idx" ON "SourceRecord" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "ReviewTask_canonicalPartId_idx" ON "ReviewTask" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SellerUploadRow_canonicalPartId_idx" ON "SellerUploadRow" ("canonicalPartId");
CREATE INDEX IF NOT EXISTS "SupportTicket_canonicalPartId_idx" ON "SupportTicket" ("canonicalPartId");
ANALYZE "SellerOffer";
ANALYZE "SalvageUnit";
SELECT 'indexes_created' AS status;
