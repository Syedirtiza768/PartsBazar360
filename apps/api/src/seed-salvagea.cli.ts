/**
 * Sync Salvage Auto Parts (US SalvageA) only from RealTrack.
 * English titles + upsert dedupe (ebayItemId / externalOfferId / sourceKey).
 *
 *   node dist/src/seed-salvagea.cli.js
 *   SEED_LISTING_LIMIT=50 node dist/src/seed-salvagea.cli.js
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IngestionProcessor } from './modules/ingestion/ingestion.processor';
import { MARKETPLACE_SELLERS } from './modules/seed/marketplace-sellers.config';
import { listingLimit } from './modules/seed/seed.config';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ingestion = app.get(IngestionProcessor);
  const store = MARKETPLACE_SELLERS.salvage;
  const report: any = {
    startedAt: new Date().toISOString(),
    store: { name: store.name, storeId: store.storeId },
    errors: [],
  };

  try {
    report.result = await ingestion.syncStoreComplete(
      store.storeId!,
      listingLimit(),
      store.storeSlug || undefined,
    );
  } catch (error) {
    report.errors.push({
      source: store.name,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    report.completedAt = new Date().toISOString();
    const reportPath = path.resolve(process.env.SEED_REPORT_PATH || '/tmp/seed-salvagea-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    await app.close();
    console.log(JSON.stringify({ reportPath, ...report }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
