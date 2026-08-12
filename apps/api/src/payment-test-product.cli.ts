/**
 * Create (or refresh) the 1 AED payment-verification product.
 *
 * Live payment rails cannot be trusted until money has actually moved through
 * them. Stripe and Tamara both behave differently in production than in
 * sandbox — 3-D Secure step-ups, real card networks, Tamara's eligibility and
 * order-status callbacks — and none of that is exercised by a sandbox key. So
 * production needs one genuinely purchasable item cheap enough to buy and
 * refund repeatedly.
 *
 * It must not become a buyer-visible listing. The part is flagged
 * `_hiddenFromCatalog`, which (via `isCatalogHidden`) removes it from both
 * search indexes, forces `noindex`, and excludes it from every sitemap — while
 * leaving its own URL reachable so a real checkout can be driven end to end.
 *
 * Idempotent: keyed on a fixed part id and a fixed offer `sourceKey`, so
 * re-running updates the same rows instead of accumulating duplicates.
 *
 * Usage (inside the api container):
 *   node dist/src/payment-test-product.cli.js
 *   node dist/src/payment-test-product.cli.js --price 1 --currency AED
 *   node dist/src/payment-test-product.cli.js --seller <sellerId>
 *   node dist/src/payment-test-product.cli.js --deactivate
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  CATALOG_HIDDEN_KEY,
  PAYMENT_TEST_PART_ID,
  PAYMENT_TEST_SLUG,
} from '@repo/catalog-contracts';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

/** Stable key so re-running updates this offer rather than creating another. */
const OFFER_SOURCE_KEY = 'internal:payment-verification:v1';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

async function main(): Promise<void> {
  const logger = new Logger('PaymentTestProduct');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);

  try {
    const deactivate = process.argv.includes('--deactivate');

    if (deactivate) {
      await prisma.sellerOffer.updateMany({
        where: { canonicalPartId: PAYMENT_TEST_PART_ID },
        data: { status: 'INACTIVE' },
      });
      logger.log('Payment-verification offer deactivated (part row kept).');
      return;
    }

    const price = Number(option('price', '1'));
    const currency = option('currency', 'AED').toUpperCase();
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid --price: ${option('price', '1')}`);
    }

    // Attach to a real, onboarded seller: checkout, fulfilment, and the
    // buyer-visible offer filters all key off seller status, so a synthetic
    // seller would exercise a different code path than a real order.
    const sellerId = option('seller', '');
    const seller = sellerId
      ? await prisma.seller.findUnique({ where: { id: sellerId } })
      : await prisma.seller.findFirst({
          where: { onboardingStatus: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        });

    if (!seller) {
      throw new Error(
        'No ACTIVE seller found. Pass --seller <id> explicitly.',
      );
    }

    const itemSpecifics: Record<string, unknown> = {
      [CATALOG_HIDDEN_KEY]: true,
      purpose:
        'Internal payment-rail verification. Not a real product. Do not order.',
    };

    const part = await prisma.canonicalPart.upsert({
      where: { id: PAYMENT_TEST_PART_ID },
      create: {
        id: PAYMENT_TEST_PART_ID,
        slug: PAYMENT_TEST_SLUG,
        slugAssignedAt: new Date(),
        title: 'Payment Verification Item (1 AED) — Internal Use Only',
        description:
          'Internal item used to verify that live card and BNPL payments complete end to end. It is not a purchasable product and will not be fulfilled.',
        category: 'Internal',
        partSource: 'OEM',
        qualityTier: 'NEW',
        partType: 'UNCLASSIFIED',
        // Hidden from the catalog, and belt-and-braces `noindex` so that even
        // if the hidden flag were cleared the page would not be indexed.
        seo: { robots: 'noindex', note: 'payment verification item' },
        itemSpecifics: itemSpecifics as never,
        // No images on purpose: nothing here should ever render as a product
        // tile, and an imageless part is noindex by the engine's own rules.
        imageUrls: [],
      },
      update: {
        slug: PAYMENT_TEST_SLUG,
        seo: { robots: 'noindex', note: 'payment verification item' },
        itemSpecifics: itemSpecifics as never,
      },
    });

    const existing = await prisma.sellerOffer.findUnique({
      where: { sourceKey: OFFER_SOURCE_KEY },
    });

    const offer = existing
      ? await prisma.sellerOffer.update({
          where: { id: existing.id },
          data: {
            price,
            currency,
            status: 'ACTIVE',
            sellerId: seller.id,
            canonicalPartId: part.id,
          },
        })
      : await prisma.sellerOffer.create({
          data: {
            sellerId: seller.id,
            canonicalPartId: part.id,
            price,
            currency,
            condition: 'NEW',
            partSource: 'OEM',
            qualityTier: 'NEW',
            status: 'ACTIVE',
            sourceKey: OFFER_SOURCE_KEY,
            sellerTitle: 'Payment Verification Item',
            moq: 1,
          },
        });

    // Push it through the indexers so any previously indexed copy is deleted.
    // `isCatalogHidden` makes both of them remove rather than write.
    await prisma.searchOutbox.create({
      data: {
        entityType: 'CanonicalPart',
        entityId: part.id,
        operation: 'UPSERT',
        payload: { reason: 'payment-verification-product' },
        status: 'PENDING',
      },
    });

    logger.log('--- Payment-verification product ready ---');
    logger.log(`  part id  : ${part.id}`);
    logger.log(`  slug     : ${part.slug}`);
    logger.log(`  URL      : /buyer/parts/${part.slug}/`);
    logger.log(`  offer id : ${offer.id}`);
    logger.log(`  price    : ${price} ${currency}`);
    logger.log(`  seller   : ${seller.name} (${seller.id})`);
    logger.log('  hidden   : yes (no search, no sitemap, noindex)');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
