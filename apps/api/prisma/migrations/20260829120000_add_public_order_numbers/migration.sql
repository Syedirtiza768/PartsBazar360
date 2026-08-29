-- Public order numbers are additive. Existing orders keep their UUIDs and
-- remain NULL in orderNumber so no historical order identifier is changed.

ALTER TABLE "Order" ADD COLUMN "orderNumber" TEXT;
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- lastNumber is seeded to 1109 so the first newly created order is PB1110.
-- The singleton row is updated inside the same transaction as each Order.
CREATE TABLE "OrderNumberSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastNumber" INTEGER NOT NULL DEFAULT 1109,
    CONSTRAINT "OrderNumberSequence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderNumberSequence_singleton_check" CHECK ("id" = 1)
);

INSERT INTO "OrderNumberSequence" ("id", "lastNumber") VALUES (1, 1109);
