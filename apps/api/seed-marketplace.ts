import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma.service';
import { MerchantUploadsService } from './src/modules/merchant/uploads.service';
import { IngestionProcessor } from './src/modules/ingestion/ingestion.processor';
import { enabled, listingLimit, storeManifest } from './src/modules/seed/seed.config';

async function ensureSeller(prisma: PrismaService, organizationId: string, input: { name: string; storeId?: string; sourcePlatform: string; externalId: string }) {
  let seller = input.storeId ? await prisma.seller.findFirst({ where: { storeId: input.storeId } }) : null;
  if (!seller) {
    seller = await prisma.seller.findFirst({ where: { organizationId, name: input.name } });
  }
  seller = seller
    ? await prisma.seller.update({ where: { id: seller.id }, data: { name: input.name, storeId: input.storeId ?? seller.storeId } })
    : await prisma.seller.create({ data: { organizationId, name: input.name, storeId: input.storeId, onboardingStatus: 'ACTIVE', activatedAt: new Date() } });
  await prisma.sellerSourceAccount.upsert({
    where: { sourcePlatform_externalAccountId: { sourcePlatform: input.sourcePlatform, externalAccountId: input.externalId } },
    update: { sellerId: seller.id, lastSyncedAt: new Date() },
    create: { sellerId: seller.id, sourcePlatform: input.sourcePlatform, externalAccountId: input.externalId, lastSyncedAt: new Date() },
  });
  const warehouse = await prisma.warehouse.findFirst({ where: { sellerId: seller.id, externalKey: 'DEFAULT' } });
  if (!warehouse) await prisma.warehouse.create({ data: { sellerId: seller.id, externalKey: 'DEFAULT', name: `${input.name} Main Warehouse` } });
  return seller;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  const uploads = app.get(MerchantUploadsService);
  const ingestion = app.get(IngestionProcessor);
  const report: any = { startedAt: new Date().toISOString(), ebaySources: [], spreadsheetSources: [], errors: [] };

  try {
    const realtrackOrg = await prisma.organization.upsert({
      where: { id: process.env.SEED_REALTRACK_ORG_ID || 'seed-realtrack-merchants' },
      update: { name: 'RealTrack Connected Merchants' },
      create: { id: process.env.SEED_REALTRACK_ORG_ID || 'seed-realtrack-merchants', name: 'RealTrack Connected Merchants' },
    });
    const spreadsheetOrg = await prisma.organization.upsert({
      where: { id: process.env.SEED_SPREADSHEET_ORG_ID || 'seed-spreadsheet-suppliers' },
      update: { name: 'Spreadsheet Inventory Suppliers' },
      create: { id: process.env.SEED_SPREADSHEET_ORG_ID || 'seed-spreadsheet-suppliers', name: 'Spreadsheet Inventory Suppliers' },
    });

    if (enabled('SEED_EBAY_STORES')) {
      for (const store of storeManifest()) {
        try {
          await ensureSeller(prisma, realtrackOrg.id, { name: store.name, storeId: store.storeId, sourcePlatform: 'EBAY_REALTRACK', externalId: store.storeId });
          report.ebaySources.push(await ingestion.syncStoreComplete(store.storeId, listingLimit()));
        } catch (error) {
          report.errors.push({ source: store.name, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    if (enabled('SEED_SPREADSHEET_SELLERS')) {
      const spreadsheetFiles = [
        { env: 'SEED_DXB_FILE', name: 'DXB-EXW Parts Supplier', brand: undefined, currency: 'AED', partSource: 'MIXED' },
        { env: 'SEED_FEBEST_FILE', name: 'FEBEST Inventory Supplier', brand: 'FEBEST', currency: process.env.SEED_FEBEST_CURRENCY, partSource: 'AFTERMARKET' },
      ];
      for (const source of spreadsheetFiles) {
        const filePath = process.env[source.env];
        if (!filePath) continue;
        try {
          const seller = await ensureSeller(prisma, spreadsheetOrg.id, { name: source.name, sourcePlatform: 'SPREADSHEET', externalId: source.env });
          const buffer = await fs.readFile(filePath);
          const job = await uploads.processUpload(seller.id, path.basename(filePath), buffer, {
            defaultPartSource: source.partSource,
            defaultQualityTier: 'NEW',
            defaultBrand: source.brand,
            defaultCurrency: source.currency,
            defaultWeightUnit: process.env.SEED_FEBEST_WEIGHT_UNIT,
            defaultDimensionUnit: process.env.SEED_FEBEST_DIMENSION_UNIT,
          });
          report.spreadsheetSources.push({ file: path.basename(filePath), seller: source.name, jobId: job.id, status: job.status, report: job.report });
        } catch (error) {
          report.errors.push({ source: source.name, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  } finally {
    report.completedAt = new Date().toISOString();
    const reportPath = path.resolve(process.env.SEED_REPORT_PATH || 'seed-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    await app.close();
    console.log(JSON.stringify({ reportPath, ...report }, null, 2));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
