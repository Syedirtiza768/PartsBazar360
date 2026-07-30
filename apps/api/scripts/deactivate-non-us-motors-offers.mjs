/**
 * Deactivate ACTIVE SellerOffers linked to RealTrack staging rows whose
 * marketplaceId is not EBAY_MOTORS_US (e.g. EBAY_GB). Buyer catalog / search
 * only show ACTIVE offers, so this hides non-US Motors listings everywhere.
 *
 *   cd /app && node scripts/deactivate-non-us-motors-offers.mjs
 *   DRY_RUN=1 node scripts/deactivate-non-us-motors-offers.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const BUYER_MARKETPLACE_ID = 'EBAY_MOTORS_US';
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const staging = await prisma.$queryRaw`
    SELECT
      COALESCE("marketplaceId", 'missing') AS mkt,
      COUNT(*)::int AS staging_rows
    FROM "RawStagingListing"
    WHERE COALESCE("marketplaceId", '') <> ${BUYER_MARKETPLACE_ID}
    GROUP BY 1
    ORDER BY staging_rows DESC
  `;

  const candidates = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n
    FROM "SellerOffer" o
    JOIN "RawStagingListing" r ON o."externalOfferId" = r."sourceListingId"
    WHERE o.status = 'ACTIVE'
      AND COALESCE(r."marketplaceId", '') <> ${BUYER_MARKETPLACE_ID}
  `;

  let deactivated = 0;
  if (!DRY_RUN) {
    deactivated = Number(
      await prisma.$executeRaw`
        UPDATE "SellerOffer" o
        SET status = 'INACTIVE', "updatedAt" = NOW()
        FROM "RawStagingListing" r
        WHERE o.status = 'ACTIVE'
          AND o."externalOfferId" = r."sourceListingId"
          AND COALESCE(r."marketplaceId", '') <> ${BUYER_MARKETPLACE_ID}
      `,
    );
    // Also catch offers matched only by sourceKey
    deactivated += Number(
      await prisma.$executeRaw`
        UPDATE "SellerOffer" o
        SET status = 'INACTIVE', "updatedAt" = NOW()
        FROM "RawStagingListing" r
        WHERE o.status = 'ACTIVE'
          AND o."sourceKey" = ('rt:' || r."storeId" || ':' || r."sourceListingId")
          AND COALESCE(r."marketplaceId", '') <> ${BUYER_MARKETPLACE_ID}
      `,
    );
  } else {
    deactivated = candidates[0]?.n || 0;
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        buyerMarketplaceId: BUYER_MARKETPLACE_ID,
        nonUsStaging: staging,
        activeOffersDeactivated: deactivated,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
