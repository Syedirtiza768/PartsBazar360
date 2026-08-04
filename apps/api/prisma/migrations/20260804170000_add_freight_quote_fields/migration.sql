-- Adds structured freight-quote fields to SupportTicket, replacing the
-- previous approach of stuffing shippingCountry/estimatedWeightKg/cartSummary
-- into the free-text `message` field for category: 'FREIGHT_QUOTE' tickets.
-- Purely additive (all nullable columns) — safe to apply directly, no
-- pre-flight data check needed, matches exactly what `prisma migrate diff`
-- generated for this schema change.

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "cartSummary" TEXT,
ADD COLUMN     "estimatedWeightKg" DOUBLE PRECISION,
ADD COLUMN     "quotedCurrency" TEXT,
ADD COLUMN     "quotedRate" DOUBLE PRECISION,
ADD COLUMN     "shippingCountry" TEXT;
