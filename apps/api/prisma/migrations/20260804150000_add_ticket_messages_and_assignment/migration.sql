-- Adds a proper reply thread (TicketMessage) and ticket ownership
-- (SupportTicket.assignedToUserId). Unlike the enum conversion in the prior
-- migration, this one is purely additive — a new nullable column and a new
-- table — so it's safe to apply directly with no pre-flight data checks.
-- This is exactly what `prisma migrate diff` generated for this schema
-- change; nothing was hand-adjusted.
--
-- Depends on 20260804120000_add_order_status_enums running first (this repo
-- only, no ordering issue in a real deploy — migrations always apply in
-- filename order).

-- CreateEnum
CREATE TYPE "TicketMessageAuthor" AS ENUM ('ADMIN', 'CUSTOMER');

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "assignedToUserId" TEXT;

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" "TicketMessageAuthor" NOT NULL,
    "authorName" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedToUserId_idx" ON "SupportTicket"("assignedToUserId");

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
