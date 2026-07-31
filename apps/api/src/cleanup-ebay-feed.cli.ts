/**
 * One-time cleanup of the eBay-US (RealTrack) feed in the buyer catalog.
 *
 * Deactivates ACTIVE SellerOffers (sourceTag BLK / SAL) whose canonical part:
 *   - has a NON-ENGLISH title (fails looksLikeEnglishTitle), OR
 *   - carries an eBay Mag image (storage.ebaymag.com) — a cross-border-trade
 *     listing excluded from the US catalog.
 * Then reindexes every affected canonical part so OpenSearch drops the ghosts.
 *
 *   node dist/src/cleanup-ebay-feed.cli.js            # DRY RUN (preview only)
 *   CONFIRM=1 node dist/src/cleanup-ebay-feed.cli.js  # apply
 *   SCOPE=BLK,SAL CONFIRM=1 node dist/src/cleanup-ebay-feed.cli.js
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { OpenSearchService } from './modules/search/opensearch.service';
import { looksLikeEnglishTitle } from './modules/ingestion/listing-title.util';
import { isEbayMagImageUrl } from './modules/ingestion/listing-enrichment.util';

async function main() {
  const CONFIRM = process.env.CONFIRM === '1';
  const SCOPE = (process.env.SCOPE || 'BLK,SAL')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const REINDEX_BATCH = Math.max(10, Number(process.env.REINDEX_BATCH || 100));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const search = app.get(OpenSearchService);

  try {
    const offers = await prisma.sellerOffer.findMany({
      where: { status: 'ACTIVE', sourceTag: { in: SCOPE } },
      include: {
        seller: { select: { onboardingStatus: true, name: true } },
        canonicalPart: {
          select: { id: true, title: true, imageUrls: true, ebayItemId: true },
        },
      },
    });

    // Buyer-visible only (ACTIVE seller) — matches the search sanitization gate.
    const visible = offers.filter(
      (o) => o.seller?.onboardingStatus === 'ACTIVE',
    );

    let nonEnglish = 0;
    let ebayMag = 0;
    const toDeactivate: typeof visible = [];
    const sample: string[] = [];
    for (const o of visible) {
      const title = o.canonicalPart?.title ?? '';
      const isNonEn = !!title && !looksLikeEnglishTitle(title);
      const hasMag =
        Array.isArray(o.canonicalPart?.imageUrls) &&
        o.canonicalPart.imageUrls.some((u: string) => isEbayMagImageUrl(u));
      if (!isNonEn && !hasMag) continue;
      if (isNonEn) nonEnglish++;
      if (hasMag) ebayMag++;
      toDeactivate.push(o);
      if (sample.length < 25) {
        sample.push(
          `[${o.sourceTag}] ${title} (ebay:${o.canonicalPart?.ebayItemId ?? '-'})${isNonEn ? ' NON-EN' : ''}${hasMag ? ' EBAYMAG' : ''}`,
        );
      }
    }

    const partIds = [...new Set(toDeactivate.map((o) => o.canonicalPartId))];

    console.log(
      `Scope: ${SCOPE.join(',')} | ACTIVE+visible offers scanned: ${visible.length}`,
    );
    console.log(
      `Would deactivate: ${toDeactivate.length} offers across ${partIds.length} parts (non-English=${nonEnglish}, ebayMag=${ebayMag})`,
    );
    if (sample.length) {
      console.log('Sample:');
      for (const s of sample) console.log(`  ${s}`);
    }

    if (!CONFIRM) {
      console.log('DRY RUN — set CONFIRM=1 to apply.');
      return;
    }
    if (toDeactivate.length === 0) {
      console.log('Nothing to deactivate.');
      return;
    }

    await prisma.sellerOffer.updateMany({
      where: { id: { in: toDeactivate.map((o) => o.id) } },
      data: { status: 'INACTIVE' },
    });
    console.log(`Deactivated ${toDeactivate.length} offers.`);

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
        `... reindexed ${Math.min(i + REINDEX_BATCH, partIds.length)}/${partIds.length}`,
      );
    }
    console.log(`Reindexed ${reindexed} parts. Done.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
