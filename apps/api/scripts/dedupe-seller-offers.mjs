#!/usr/bin/env node
/**
 * For Blackline (BLK) and Salvage (SAL): when a seller has multiple ACTIVE
 * offers on the same CanonicalPart, keep only the lowest-price offer and
 * deactivate the rest.
 *
 * Usage:
 *   node scripts/dedupe-seller-offers.mjs
 *   DRY_RUN=1 node scripts/dedupe-seller-offers.mjs
 */
import { Client as PgClient } from 'pg';

const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  const sellerIds = ['seller-blackline-auto-parts', 'seller-salvage-auto-parts'];

  for (const sellerId of sellerIds) {
    // Find canonical parts where this seller has >1 ACTIVE offer
    const { rows: dupes } = await pg.query(`
      SELECT so."canonicalPartId", COUNT(*) as cnt
      FROM "SellerOffer" so
      WHERE so."sellerId" = $1
        AND so.status = 'ACTIVE'
      GROUP BY so."canonicalPartId"
      HAVING COUNT(*) > 1
    `, [sellerId]);

    console.log(`[${sellerId}] ${dupes.length} canonical parts with duplicate offers`);

    let deactivated = 0;

    for (const row of dupes) {
      // Get all ACTIVE offers for this seller+part, ordered by price ASC
      const { rows: offers } = await pg.query(`
        SELECT so.id, so.price, so."sellerBasePrice", so."sourceTag", so."externalOfferId"
        FROM "SellerOffer" so
        WHERE so."sellerId" = $1
          AND so."canonicalPartId" = $2
          AND so.status = 'ACTIVE'
        ORDER BY so.price ASC
      `, [sellerId, row.canonicalPartId]);

      if (offers.length <= 1) continue;

      // Keep the first (lowest price), deactivate the rest
      const keep = offers[0];
      const remove = offers.slice(1);

      for (const offer of remove) {
        if (DRY_RUN) {
          console.log(`  [DRY] Would deactivate offer ${offer.id} (price=${offer.price}) for part ${row.canonicalPartId}, keeping ${keep.id} (price=${keep.price})`);
        } else {
          await pg.query(`
            UPDATE "SellerOffer" SET status = 'INACTIVE', "updatedAt" = NOW()
            WHERE id = $1
          `, [offer.id]);
        }
        deactivated++;
      }
    }

    console.log(`[${sellerId}] ${DRY_RUN ? 'Would deactivate' : 'Deactivated'} ${deactivated} duplicate offers`);
  }

  if (!DRY_RUN) {
    console.log('\nDone. Run reindex-active-from-db.mjs to update OpenSearch.');
  }

  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
