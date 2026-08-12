/**
 * Reconcile Blackline / Salvage ACTIVE offers against an authoritative eBay
 * "Active listings" export (xlsx from Seller Hub), keyed by eBay Item number.
 *
 * The RealTrack mirror we sync from can carry listings (other marketplaces,
 * cross-border variants) that are not part of the seller's actual US active
 * inventory. This script makes the exported file the source of truth per
 * store:
 *
 *   - ACTIVE offers whose CanonicalPart.ebayItemId is NOT in the file
 *     -> deactivated (status = INACTIVE), then the part is reindexed so
 *        OpenSearch drops it.
 *   - Item numbers in the file with no matching ACTIVE offer in the DB
 *     -> reported only (not created/reactivated) — these need a RealTrack
 *        re-sync to backfill, which is a separate step.
 *
 *   BLACKLINE_FILE=/path/to/Blackline_US_Active_listings.xlsx \
 *   SALVAGE_FILE=/path/to/Salvage_US_Active_listings.xlsx \
 *   node dist/src/reconcile-active-listings.cli.js                    # DRY RUN
 *
 *   ...CONFIRM=1 node dist/src/reconcile-active-listings.cli.js       # apply
 *   SCOPE=BLK node dist/src/reconcile-active-listings.cli.js          # one store only
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { OpenSearchService } from './modules/search/opensearch.service';
import { MARKETPLACE_SELLERS } from './modules/seed/marketplace-sellers.config';
import { readActiveItemNumbers } from './modules/catalog-import/active-listings-file.util';

type Scope = 'BLK' | 'SAL';

const STORE_CLI_CONFIG: Record<
  Scope,
  { sellerKey: 'blackline' | 'salvage'; fileEnv: string }
> = {
  BLK: { sellerKey: 'blackline', fileEnv: 'BLACKLINE_FILE' },
  SAL: { sellerKey: 'salvage', fileEnv: 'SALVAGE_FILE' },
};

async function main() {
  const CONFIRM = process.env.CONFIRM === '1';
  const SCOPE = (process.env.SCOPE || 'BLK,SAL')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as Scope[];
  const REINDEX_BATCH = Math.max(10, Number(process.env.REINDEX_BATCH || 100));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const search = app.get(OpenSearchService);

  const summary: Record<string, any> = {};

  try {
    for (const tag of SCOPE) {
      const cfg = STORE_CLI_CONFIG[tag];
      if (!cfg) {
        console.warn(`Unknown scope "${tag}", skipping.`);
        continue;
      }
      const filePath = process.env[cfg.fileEnv];
      if (!filePath) {
        console.warn(`${cfg.fileEnv} is not set, skipping ${tag}.`);
        continue;
      }

      const sellerConfig = MARKETPLACE_SELLERS[cfg.sellerKey];
      console.log(`\n=== ${tag} — ${sellerConfig.name} — reading ${filePath}`);

      const fileRows = await readActiveItemNumbers(filePath);
      console.log(`File declares ${fileRows.size} active listings.`);

      const seller = await prisma.seller.findFirst({
        where: {
          OR: [
            { id: sellerConfig.id },
            { storeId: sellerConfig.storeId ?? undefined },
            { name: sellerConfig.name },
          ],
        },
        select: { id: true, name: true },
      });
      if (!seller) {
        console.warn(`No seller found for ${sellerConfig.name}, skipping.`);
        continue;
      }

      const activeOffers = await prisma.sellerOffer.findMany({
        where: { sellerId: seller.id, sourceTag: tag, status: 'ACTIVE' },
        select: {
          id: true,
          canonicalPartId: true,
          canonicalPart: { select: { ebayItemId: true } },
        },
      });
      console.log(`DB has ${activeOffers.length} ACTIVE offers for ${seller.name}.`);

      const toDeactivate = activeOffers.filter(
        (o) =>
          o.canonicalPart?.ebayItemId &&
          !fileRows.has(o.canonicalPart.ebayItemId),
      );

      const matchedIds = new Set(
        activeOffers
          .map((o) => o.canonicalPart?.ebayItemId)
          .filter((v): v is string => !!v),
      );
      const missingFromDb = [...fileRows.keys()].filter(
        (id) => !matchedIds.has(id),
      );

      console.log(
        `Would deactivate ${toDeactivate.length} ACTIVE offers not present in the file.`,
      );
      console.log(
        `${missingFromDb.length} file listings have no matching ACTIVE offer in the DB (need a RealTrack re-sync to backfill; this script does not create them).`,
      );
      if (toDeactivate.length) {
        console.log(
          '  sample to deactivate:',
          toDeactivate
            .slice(0, 10)
            .map((o) => o.canonicalPart?.ebayItemId)
            .join(', '),
        );
      }
      if (missingFromDb.length) {
        console.log(
          '  sample missing from DB:',
          missingFromDb.slice(0, 10).join(', '),
        );
      }

      summary[tag] = {
        store: sellerConfig.name,
        fileCount: fileRows.size,
        dbActiveCount: activeOffers.length,
        toDeactivate: toDeactivate.length,
        missingFromDb: missingFromDb.length,
        applied: false,
      };

      if (!CONFIRM) {
        console.log(`DRY RUN for ${tag} — set CONFIRM=1 to apply.`);
        continue;
      }
      if (toDeactivate.length === 0) {
        console.log(`Nothing to deactivate for ${tag}.`);
        continue;
      }

      await prisma.sellerOffer.updateMany({
        where: { id: { in: toDeactivate.map((o) => o.id) } },
        data: { status: 'INACTIVE' },
      });
      console.log(`Deactivated ${toDeactivate.length} offers for ${tag}.`);
      summary[tag].applied = true;

      const partIds = [...new Set(toDeactivate.map((o) => o.canonicalPartId))];
      let reindexed = 0;
      for (let i = 0; i < partIds.length; i += REINDEX_BATCH) {
        const slice = partIds.slice(i, i + REINDEX_BATCH);
        const parts = await prisma.canonicalPart.findMany({
          where: { id: { in: slice } },
          include: {
            offers: { include: { seller: true } },
            partNumbers: true,
          },
        });
        for (const part of parts) {
          try {
            await search.indexPart(part);
            reindexed++;
          } catch (err) {
            console.warn(
              `reindex failed for ${part.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        console.log(
          `  ... reindexed ${Math.min(i + REINDEX_BATCH, partIds.length)}/${partIds.length}`,
        );
      }
      console.log(`Reindexed ${reindexed} parts for ${tag}.`);
    }

    console.log('\n=== Summary ===');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
