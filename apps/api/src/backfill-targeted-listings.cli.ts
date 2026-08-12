/**
 * Backfill Blackline / Salvage listings that appear in an authoritative eBay
 * "Active listings" export but have no offer at all in our DB yet — without
 * a full unbounded RealTrack resync (which reprocesses every listing RealTrack
 * returns for the store, most of which are irrelevant/already synced).
 *
 * Must run in a container where RUN_INGESTION_WORKER=1 (IngestionProcessor is
 * only registered there) — the `worker` service, not `api`.
 *
 *   BLACKLINE_FILE=/path/to/blackline.csv \
 *   SALVAGE_FILE=/path/to/salvage.xlsx \
 *   node dist/src/backfill-targeted-listings.cli.js
 *
 *   SCOPE=BLK node dist/src/backfill-targeted-listings.cli.js   # one store only
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { IngestionProcessor } from './modules/ingestion/ingestion.processor';
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
  const SCOPE = (process.env.SCOPE || 'BLK,SAL')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as Scope[];

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const ingestion = app.get(IngestionProcessor);

  const report: Record<string, any> = {};

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
        select: { id: true },
      });
      if (!seller) {
        console.warn(`No seller found for ${sellerConfig.name}, skipping.`);
        continue;
      }

      // Any offer at all (not just ACTIVE) counts as "already have it" —
      // we only want to create rows for listings we've never seen.
      const existing = await prisma.sellerOffer.findMany({
        where: { sellerId: seller.id, sourceTag: tag },
        select: { canonicalPart: { select: { ebayItemId: true } } },
      });
      const existingIds = new Set(
        existing
          .map((o) => o.canonicalPart?.ebayItemId)
          .filter((v): v is string => !!v),
      );
      const targetIds = new Set(
        [...fileRows.keys()].filter((id) => !existingIds.has(id)),
      );
      console.log(`${targetIds.size} listings to backfill (missing from DB entirely).`);

      if (targetIds.size === 0) {
        report[tag] = { store: sellerConfig.name, targeted: 0 };
        continue;
      }

      const result = await ingestion.syncTargetedListings(
        sellerConfig.storeId!,
        sellerConfig.storeSlug || undefined,
        targetIds,
      );
      console.log(
        `${tag}: scanned=${result.scanned} imported=${result.imported} notFoundInRealTrack=${result.notFound.length} errors=${result.errors.length}`,
      );
      if (result.notFound.length) {
        console.log(
          '  sample not found in RealTrack:',
          result.notFound.slice(0, 10).join(', '),
        );
      }
      if (result.errors.length) {
        console.log(
          '  sample errors:',
          JSON.stringify(result.errors.slice(0, 5)),
        );
      }
      report[tag] = { store: sellerConfig.name, targeted: targetIds.size, ...result };
    }

    console.log('\n=== Summary ===');
    console.log(JSON.stringify(report, null, 2));

    const reportPath = path.resolve(
      process.env.BACKFILL_REPORT_PATH || '/tmp/backfill-targeted-report.json',
    );
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
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
