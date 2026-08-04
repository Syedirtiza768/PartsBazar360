-- Converts Order.status, SellerOrder.status, and PaymentIntent.status from
-- free-form strings to Postgres enums, and adds a transition guard in app
-- code (OrderStatusService) so future writes can't skip lifecycle states.
--
-- *** DO NOT REGENERATE THIS FILE WITH `prisma migrate dev` ***
-- Prisma's default diff for a String -> enum column change is DROP COLUMN
-- + ADD COLUMN (verified by running `prisma migrate diff` against this
-- exact schema change) — that silently wipes every existing row's status
-- back to the column default. This file instead uses ALTER COLUMN ... TYPE
-- ... USING to cast existing values in place, preserving all order/payment
-- history. If Prisma's CLI ever offers to regenerate/reset this migration,
-- decline and keep this hand-written version.
--
-- *** BEFORE APPLYING THIS TO A DATABASE WITH EXISTING DATA ***
-- Run these against production first and confirm every row's status is one
-- of the values below. This migration was written from a full code audit
-- (every prisma.order / prisma.sellerOrder / prisma.paymentIntent write in
-- the codebase), not from live data, because no database was reachable in
-- the environment this was written in. If any row has an unexpected value,
-- the ALTER COLUMN ... USING cast below will fail and the whole migration
-- rolls back (safe — Postgres DDL is transactional) — but you should know
-- about it before that happens, not find out from a failed deploy.
--
--   SELECT DISTINCT status, count(*) FROM "Order" GROUP BY status;
--   SELECT DISTINCT status, count(*) FROM "SellerOrder" GROUP BY status;
--   SELECT DISTINCT status, count(*) FROM "PaymentIntent" GROUP BY status;
--
-- Expected Order.status values:        PENDING_PAYMENT, PAID, PAYMENT_FAILED
-- Expected SellerOrder.status values:  AWAITING_PAYMENT, PROCESSING, SHIPPED
--   (CANCELLED, DELIVERED, REFUNDED are new terminal states nothing writes yet)
-- Expected PaymentIntent.status values: PENDING, SUCCEEDED, FAILED
--   (REFUNDED is a new terminal state for the admin refund endpoint, nothing writes it yet)
--
-- One exception already handled below: the operations dashboard queried for
-- a SellerOrder status of 'READY_TO_SHIP', but no code path was ever found
-- that writes it — most likely dead/aspirational. If any row does carry it,
-- this migration normalizes it to PROCESSING (its closest real meaning)
-- rather than failing outright. If you see other unexpected values from the
-- queries above, stop and adjust this file before running it.

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PAYMENT_FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SellerOrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PROCESSING', 'SHIPPED', 'CANCELLED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- Normalize the one known-dead legacy value before the type conversion (see note above).
UPDATE "SellerOrder" SET "status" = 'PROCESSING' WHERE "status" = 'READY_TO_SHIP';

-- AlterTable: Order.status
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::text::"OrderStatus");
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- AlterTable: SellerOrder.status
ALTER TABLE "SellerOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SellerOrder" ALTER COLUMN "status" TYPE "SellerOrderStatus" USING ("status"::text::"SellerOrderStatus");
ALTER TABLE "SellerOrder" ALTER COLUMN "status" SET DEFAULT 'AWAITING_PAYMENT';

-- AlterTable: PaymentIntent.status
ALTER TABLE "PaymentIntent" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PaymentIntent" ALTER COLUMN "status" TYPE "PaymentStatus" USING ("status"::text::"PaymentStatus");
ALTER TABLE "PaymentIntent" ALTER COLUMN "status" SET DEFAULT 'PENDING';
