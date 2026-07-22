import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { MerchantUploadsService } from './modules/merchant/uploads.service';
import { IngestionProcessor } from './modules/ingestion/ingestion.processor';
import { AuthService } from './modules/auth/auth.service';
import { enabled, listingLimit, storeManifest } from './modules/seed/seed.config';
import {
  MARKETPLACE_ORG,
  MARKETPLACE_SELLERS,
  REALTRACK_MARKETPLACE_SELLERS,
} from './modules/seed/marketplace-sellers.config';
import { deactivateLegacySellers } from './modules/seed/deactivate-legacy-sellers';
import { wipeMarketplaceSellerInventory } from './modules/seed/wipe-marketplace-inventory';
import { MARKETPLACE_CURRENCY } from './modules/ingestion/listing-eligibility.util';

async function ensureSeller(
  prisma: PrismaService,
  organizationId: string,
  input: {
    id?: string;
    name: string;
    storeId?: string | null;
    sourcePlatform: string;
    externalId: string;
  },
) {
  let seller = input.id
    ? await prisma.seller.findUnique({ where: { id: input.id } })
    : null;
  if (!seller && input.storeId) {
    seller = await prisma.seller.findFirst({ where: { storeId: input.storeId } });
  }
  if (!seller) {
    seller = await prisma.seller.findFirst({ where: { organizationId, name: input.name } });
  }

  const data = {
    name: input.name,
    storeId: input.storeId ?? null,
    onboardingStatus: 'ACTIVE' as const,
    activatedAt: new Date(),
  };

  seller = seller
    ? await prisma.seller.update({ where: { id: seller.id }, data })
    : await prisma.seller.create({
        data: {
          id: input.id,
          organizationId,
          ...data,
        },
      });

  await prisma.sellerSourceAccount.upsert({
    where: {
      sourcePlatform_externalAccountId: {
        sourcePlatform: input.sourcePlatform,
        externalAccountId: input.externalId,
      },
    },
    update: { sellerId: seller.id, lastSyncedAt: new Date() },
    create: {
      sellerId: seller.id,
      sourcePlatform: input.sourcePlatform,
      externalAccountId: input.externalId,
      lastSyncedAt: new Date(),
    },
  });

  const warehouse = await prisma.warehouse.findFirst({
    where: { sellerId: seller.id, externalKey: 'DEFAULT' },
  });
  if (!warehouse) {
    await prisma.warehouse.create({
      data: {
        sellerId: seller.id,
        externalKey: 'DEFAULT',
        name: `${input.name} Main Warehouse`,
      },
    });
  }

  return seller;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const uploads = app.get(MerchantUploadsService);
  const ingestion = app.get(IngestionProcessor);
  const auth = app.get(AuthService);
  const report: any = {
    startedAt: new Date().toISOString(),
    sellers: [],
    ebaySources: [],
    spreadsheetSources: [],
    authUsers: [],
    errors: [],
  };

  try {
    const org = await prisma.organization.upsert({
      where: { id: process.env.SEED_MARKETPLACE_ORG_ID || MARKETPLACE_ORG.id },
      update: { name: MARKETPLACE_ORG.name },
      create: {
        id: process.env.SEED_MARKETPLACE_ORG_ID || MARKETPLACE_ORG.id,
        name: MARKETPLACE_ORG.name,
      },
    });

    const sellerByKey: Record<string, { id: string; name: string; storeId: string | null }> = {};
    for (const cfg of Object.values(MARKETPLACE_SELLERS)) {
      const seller = await ensureSeller(prisma, org.id, {
        id: cfg.id,
        name: cfg.name,
        storeId: cfg.storeId,
        sourcePlatform: cfg.sourcePlatform,
        externalId: cfg.externalAccountId,
      });
      sellerByKey[cfg.key] = { id: seller.id, name: seller.name, storeId: seller.storeId };
      report.sellers.push({
        id: seller.id,
        name: seller.name,
        storeId: seller.storeId,
        source: cfg.sourcePlatform,
      });
    }

    // Wipe existing 3-store inventory for a fresh catalog load
    if (enabled('SEED_WIPE_MARKETPLACE_INVENTORY', true)) {
      report.wiped = await wipeMarketplaceSellerInventory(prisma);
    }

    // Suspend every seller outside Salvage / Blackline / Superior
    if (enabled('SEED_DEACTIVATE_LEGACY_SELLERS', true)) {
      report.deactivated = await deactivateLegacySellers(prisma);
    }

    // RealTrack: Salvage ← salvagea only; Blackline ← blacklineusedautoparts only
    if (enabled('SEED_EBAY_STORES', true)) {
      for (const store of storeManifest()) {
        const allowed = REALTRACK_MARKETPLACE_SELLERS.find((s) => s.storeId === store.storeId);
        if (!allowed) {
          report.errors.push({
            source: store.name,
            message: `Skipped: not in initial marketplace RealTrack map (isolation)`,
          });
          continue;
        }
        try {
          report.ebaySources.push(
            await ingestion.syncStoreComplete(
              store.storeId,
              listingLimit(),
              allowed.storeSlug || undefined,
            ),
          );
        } catch (error) {
          report.errors.push({
            source: store.name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Superior Auto Parts: spreadsheet catalogs
    if (enabled('SEED_SPREADSHEET_SELLERS', true)) {
      const superior = sellerByKey.superior;
      const spreadsheetFiles = [
        {
          env: 'SEED_FEBEST_FILE',
          label: 'FEBEST Availability',
          brand: 'FEBEST',
          currency: process.env.SEED_FEBEST_CURRENCY || MARKETPLACE_CURRENCY,
          partSource: 'AFTERMARKET',
        },
        {
          env: 'SEED_DXB_FILE',
          label: 'DXB-EXW',
          brand: undefined as string | undefined,
          currency: process.env.SEED_DXB_CURRENCY || MARKETPLACE_CURRENCY,
          partSource: 'MIXED',
        },
        // Dynatrade is opt-in only (SEED_INCLUDE_DYNATRADE=1).
        ...(process.env.SEED_INCLUDE_DYNATRADE === '1'
          ? [
              {
                env: 'SEED_DYNATRADE_FILE',
                label: 'Dynatrade Stock List',
                brand: undefined as string | undefined,
                currency: process.env.SEED_DYNATRADE_CURRENCY || MARKETPLACE_CURRENCY,
                partSource: 'AFTERMARKET',
              },
            ]
          : []),
      ];

      for (const source of spreadsheetFiles) {
        const filePath = process.env[source.env];
        if (!filePath) continue;
        try {
          const buffer = await fs.readFile(filePath);
          const job = await uploads.processUpload(
            superior.id,
            path.basename(filePath),
            buffer,
            {
              defaultPartSource: source.partSource,
              defaultQualityTier: 'NEW',
              defaultBrand: source.brand,
              defaultCurrency: source.currency,
              defaultWeightUnit: process.env.SEED_FEBEST_WEIGHT_UNIT,
              defaultDimensionUnit: process.env.SEED_FEBEST_DIMENSION_UNIT,
            },
          );
          report.spreadsheetSources.push({
            file: path.basename(filePath),
            seller: superior.name,
            label: source.label,
            jobId: job.id,
            status: job.status,
            report: job.report,
          });
        } catch (error) {
          report.errors.push({
            source: source.label,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (enabled('SEED_AUTH_USERS', true)) {
      report.authUsers = await auth.seedMarketplaceUsers();
    }
  } finally {
    report.completedAt = new Date().toISOString();
    const reportPath = path.resolve(process.env.SEED_REPORT_PATH || 'seed-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    await app.close();
    console.log(JSON.stringify({ reportPath, ...report }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
