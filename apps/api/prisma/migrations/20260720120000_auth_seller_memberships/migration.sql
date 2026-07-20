-- Initial marketplace auth: password hashes + seller memberships
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

CREATE TABLE IF NOT EXISTS "SellerMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SellerMembership_userId_sellerId_key" ON "SellerMembership"("userId", "sellerId");
CREATE INDEX IF NOT EXISTS "SellerMembership_sellerId_idx" ON "SellerMembership"("sellerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SellerMembership_userId_fkey'
  ) THEN
    ALTER TABLE "SellerMembership"
      ADD CONSTRAINT "SellerMembership_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SellerMembership_sellerId_fkey'
  ) THEN
    ALTER TABLE "SellerMembership"
      ADD CONSTRAINT "SellerMembership_sellerId_fkey"
      FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
