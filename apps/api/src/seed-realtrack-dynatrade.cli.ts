/**
 * Re-run RealTrack (Salvage storeId + Blackline) and Dynatrade only.
 * Also activates Superior REVIEW→ACTIVE where stock > 0.
 *
 *   node dist/src/seed-realtrack-dynatrade.cli.js
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { MerchantUploadsService } from './modules/merchant/uploads.service';
import { IngestionProcessor } from './modules/ingestion/ingestion.processor';
import {
  MARKETPLACE_SELLERS,
  REALTRACK_MARKETPLACE_SELLERS,
} from './modules/seed/marketplace-sellers.config';
import { activateSuperiorInStockOffers } from './modules/seed/activate-superior-offers';
import { MARKETPLACE_CURRENCY } from './modules/ingestion/listing-eligibility.util';
import { listingLimit } from './modules/seed/seed.config';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const uploads = app.get(MerchantUploadsService);
  const ingestion = app.get(IngestionProcessor);
  const report: any = {
    startedAt: new Date().toISOString(),
    ebaySources: [],
    spreadsheetSources: [],
    errors: [],
  };

  try {
    report.activatedSuperior = await activateSuperiorInStockOffers(prisma);

    for (const store of REALTRACK_MARKETPLACE_SELLERS) {
      try {
        report.ebaySources.push(
          await ingestion.syncStoreComplete(
            store.storeId!,
            listingLimit(),
            store.storeSlug || undefined,
          ),
        );
      } catch (error) {
        report.errors.push({
          source: store.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const dynatradePath = process.env.SEED_DYNATRADE_FILE;
    if (dynatradePath) {
      try {
        const superior = await prisma.seller.findFirst({
          where: {
            OR: [
              { id: MARKETPLACE_SELLERS.superior.id },
              { name: MARKETPLACE_SELLERS.superior.name },
            ],
          },
        });
        if (!superior) throw new Error('Superior Auto Parts seller not found');
        const buffer = await fs.readFile(dynatradePath);
        // New checksum path: allow re-import after failed attempt by renaming conceptually via timestamp suffix in report only —
        // clear prior failed/incomplete Dynatrade job checksum block by deleting matching failed jobs.
        await prisma.sellerUploadJob.deleteMany({
          where: {
            sellerId: superior.id,
            fileName: { contains: 'Dynatrade' },
            status: { in: ['FAILED', 'PROCESSING'] },
          },
        });
        const job = await uploads.processUpload(
          superior.id,
          path.basename(dynatradePath),
          buffer,
          {
            defaultPartSource: 'AFTERMARKET',
            defaultQualityTier: 'NEW',
            defaultCurrency: process.env.SEED_DYNATRADE_CURRENCY || MARKETPLACE_CURRENCY,
          },
        );
        report.spreadsheetSources.push({
          file: path.basename(dynatradePath),
          seller: superior.name,
          jobId: job.id,
          status: job.status,
          report: job.report,
        });
        // Activate newly imported Dynatrade rows too
        report.activatedSuperiorAfterDynatrade = await activateSuperiorInStockOffers(prisma);
      } catch (error) {
        report.errors.push({
          source: 'Dynatrade Stock List',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      report.errors.push({ source: 'Dynatrade Stock List', message: 'SEED_DYNATRADE_FILE not set' });
    }
  } finally {
    report.completedAt = new Date().toISOString();
    const reportPath = path.resolve(process.env.SEED_REPORT_PATH || 'seed-realtrack-dynatrade-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    await app.close();
    console.log(JSON.stringify({ reportPath, ...report }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
