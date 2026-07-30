import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma.service';
import { MerchantUploadsService } from './src/modules/merchant/uploads.service';
import { IngestionProcessor } from './src/modules/ingestion/ingestion.processor';
import { AuthService } from './src/modules/auth/auth.service';
import { enabled, listingLimit, storeManifest } from './src/modules/seed/seed.config';
import {
  MARKETPLACE_ORG,
  MARKETPLACE_SELLERS,
  REALTRACK_MARKETPLACE_SELLERS,
} from './src/modules/seed/marketplace-sellers.config';

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
    update: { sellerId: seller.id, marketplace: 'US', lastSyncedAt: new Date() },
    create: {
      sellerId: seller.id,
      sourcePlatform: input.sourcePlatform,
      externalAccountId: input.externalId,
      marketplace: 'US',
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

    // ── Two marketplace sellers (Salvage + Blackline only) ───────────────
    for (const cfg of REALTRACK_MARKETPLACE_SELLERS) {
      const seller = await ensureSeller(prisma, org.id, {
        id: cfg.id,
        name: cfg.name,
        storeId: cfg.storeId,
        sourcePlatform: cfg.sourcePlatform,
        externalId: cfg.externalAccountId,
      });
      report.sellers.push({
        id: seller.id,
        name: seller.name,
        storeId: seller.storeId,
        source: cfg.sourcePlatform,
      });
    }

    // ── RealTrack: Salvage ← Salvage store only; Blackline ← Blackline only ──
    if (enabled('SEED_EBAY_STORES', true)) {
      for (const store of storeManifest()) {
        const allowed = REALTRACK_MARKETPLACE_SELLERS.some((s) => s.storeId === store.storeId);
        if (!allowed) {
          report.errors.push({
            source: store.name,
            message: `Skipped: not in initial marketplace RealTrack map (isolation)`,
          });
          continue;
        }
        try {
          report.ebaySources.push(
            await ingestion.syncStoreComplete(store.storeId, listingLimit()),
          );
        } catch (error) {
          report.errors.push({
            source: store.name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // ── Spreadsheet sellers: DISABLED (OEM USED marketplace only) ────────
    // Removed: Superior Auto Parts and FEBEST are no longer part of the marketplace.

    // ── Auth: 3 logins per seller + 1 admin ────────────────────────────
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
