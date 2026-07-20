/**
 * Lightweight seed: ensure 3 sellers, deactivate legacy stores, seed auth users.
 * Does NOT run RealTrack or spreadsheet imports (safe while a full sync is running).
 *
 *   node dist/src/seed-cleanup-auth.cli.js
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { AuthService } from './modules/auth/auth.service';
import {
  MARKETPLACE_ORG,
  MARKETPLACE_SELLERS,
} from './modules/seed/marketplace-sellers.config';
import { deactivateLegacySellers } from './modules/seed/deactivate-legacy-sellers';

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
    onboardingNotes: null as string | null,
  };

  seller = seller
    ? await prisma.seller.update({ where: { id: seller.id }, data })
    : await prisma.seller.create({
        data: { id: input.id, organizationId, ...data },
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
  const auth = app.get(AuthService);
  const report: any = { startedAt: new Date().toISOString() };

  try {
    const org = await prisma.organization.upsert({
      where: { id: process.env.SEED_MARKETPLACE_ORG_ID || MARKETPLACE_ORG.id },
      update: { name: MARKETPLACE_ORG.name },
      create: {
        id: process.env.SEED_MARKETPLACE_ORG_ID || MARKETPLACE_ORG.id,
        name: MARKETPLACE_ORG.name,
      },
    });

    report.sellers = [];
    for (const cfg of Object.values(MARKETPLACE_SELLERS)) {
      const seller = await ensureSeller(prisma, org.id, {
        id: cfg.id,
        name: cfg.name,
        storeId: cfg.storeId,
        sourcePlatform: cfg.sourcePlatform,
        externalId: cfg.externalAccountId,
      });
      report.sellers.push({ id: seller.id, name: seller.name, storeId: seller.storeId });
    }

    report.deactivated = await deactivateLegacySellers(prisma);
    report.authUsers = await auth.seedMarketplaceUsers();
  } finally {
    report.completedAt = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
