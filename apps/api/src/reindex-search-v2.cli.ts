/**
 * Build the versioned v2 search index from PostgreSQL (brief §19).
 *
 * PostgreSQL is the source of truth, so the rebuild reads from it rather than
 * from the existing index — which is missing ~13,454 buyer-visible parts and
 * has `normalizedPartNumbers` empty on 52 % of documents
 * (docs/SEARCH_PHASE1_AUDIT.md §4 RC-1, RC-7).
 *
 * The alias is NOT moved by this script. It builds and verifies the candidate
 * index and then prints the exact command to promote it, so going live stays a
 * deliberate, separately-approved action.
 *
 *   node dist/src/reindex-search-v2.cli.js                # build + verify
 *   REINDEX_LIMIT=5000 node dist/src/reindex-search-v2.cli.js   # test slice
 *   REINDEX_PROMOTE=1 node dist/src/reindex-search-v2.cli.js    # build + swap alias
 *
 * Env:
 *   REINDEX_LIMIT     stop after N parts (0 = all)
 *   REINDEX_BATCH     parts per page, default 1000
 *   REINDEX_PROMOTE   "1" to swap the alias after verification passes
 *   REINDEX_DROP_OLD  "1" to delete the previous physical index after promotion
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from '@opensearch-project/opensearch';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { IndexAdminService } from './modules/search/index/index-admin.service';
import {
  SEARCH_ALIAS,
  SEARCH_INDEX_VERSION,
  physicalIndexName,
} from './modules/search/index/search-index.schema';
import { buildSearchDocument } from './modules/search/index/search-document.builder';

const BATCH = Number(process.env.REINDEX_BATCH || 1000);
const LIMIT = Number(process.env.REINDEX_LIMIT || 0);
const PROMOTE = process.env.REINDEX_PROMOTE === '1';
const DROP_OLD = process.env.REINDEX_DROP_OLD === '1';

interface Stats {
  scanned: number;
  indexed: number;
  skippedNoOffer: number;
  failed: number;
  withSearchNumbers: number;
  withPartType: number;
  withImage: number;
  withYears: number;
}

async function main() {
  const startedAt = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const client = new Client({
    node: process.env.OPENSEARCH_URL || 'http://opensearch:9200',
  });
  const admin = new IndexAdminService(client);

  const target = physicalIndexName(SEARCH_INDEX_VERSION);
  console.log(`[reindex] target index: ${target}`);

  await admin.createIndex(SEARCH_INDEX_VERSION);
  await admin.beginBulk(target);

  const stats: Stats = {
    scanned: 0,
    indexed: 0,
    skippedNoOffer: 0,
    failed: 0,
    withSearchNumbers: 0,
    withPartType: 0,
    withImage: 0,
    withYears: 0,
  };

  // Keyset pagination on the primary key — stable under concurrent writes and
  // constant-cost, unlike OFFSET which degrades on deep pages.
  let cursor: string | undefined;

  for (;;) {
    const parts = await prisma.canonicalPart.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        offers: {
          where: { status: 'ACTIVE' },
          include: { seller: { select: { name: true, onboardingStatus: true } } },
        },
        fitments: {
          select: { vehicleConfigId: true, evidenceLevel: true, confidence: true },
        },
      },
    });

    if (parts.length === 0) break;
    cursor = parts[parts.length - 1].id;

    const operations: any[] = [];
    for (const part of parts) {
      stats.scanned++;

      let document: ReturnType<typeof buildSearchDocument>;
      try {
        document = buildSearchDocument({
          ...part,
          // `compatibility` is JSON on the model; the builder expects an array.
          compatibility: Array.isArray(part.compatibility) ? part.compatibility : [],
          offers: part.offers.map((offer: any) => ({
            ...offer,
            sellerName: offer.seller?.name ?? null,
            sellerOnboardingStatus: offer.seller?.onboardingStatus ?? null,
          })),
        });
      } catch (error: any) {
        stats.failed++;
        console.error(`[reindex] build failed for ${part.id}: ${error?.message}`);
        continue;
      }

      if (!document) {
        stats.skippedNoOffer++;
        continue;
      }

      if ((document.searchNumbers as string[])?.length) stats.withSearchNumbers++;
      if (document.partType) stats.withPartType++;
      if (document.hasImage) stats.withImage++;
      if ((document.years as number[])?.length) stats.withYears++;

      operations.push({ index: { _index: target, _id: document.id } });
      operations.push(document);
    }

    if (operations.length) {
      const response: any = await client.bulk({ body: operations });
      if (response.body?.errors) {
        for (const item of response.body.items ?? []) {
          const error = item.index?.error;
          if (error) {
            stats.failed++;
            if (stats.failed <= 5) {
              console.error(`[reindex] bulk error: ${error.type}: ${error.reason}`);
            }
          }
        }
      }
      stats.indexed += operations.length / 2;
    }

    const elapsed = (Date.now() - startedAt) / 1000;
    console.log(
      `[reindex] scanned=${stats.scanned} indexed=${stats.indexed} ` +
        `skipped=${stats.skippedNoOffer} failed=${stats.failed} ` +
        `(${(stats.scanned / Math.max(elapsed, 1)).toFixed(0)}/s)`,
    );

    if (LIMIT && stats.scanned >= LIMIT) break;
  }

  await admin.finishBulk(target, Number(process.env.OPENSEARCH_REPLICAS || 0));

  const docs = await admin.countDocs(target);
  const pct = (n: number) => `${((n / Math.max(stats.indexed, 1)) * 100).toFixed(1)}%`;

  console.log('\n=== reindex summary ===');
  console.log(`index                 ${target}`);
  console.log(`parts scanned         ${stats.scanned}`);
  console.log(`documents indexed     ${stats.indexed}`);
  console.log(`skipped (no offer)    ${stats.skippedNoOffer}`);
  console.log(`failed                ${stats.failed}`);
  console.log(`docs in index         ${docs}`);
  console.log(`with searchNumbers    ${stats.withSearchNumbers} (${pct(stats.withSearchNumbers)})`);
  console.log(`with partType         ${stats.withPartType} (${pct(stats.withPartType)})`);
  console.log(`with image            ${stats.withImage} (${pct(stats.withImage)})`);
  console.log(`with years            ${stats.withYears} (${pct(stats.withYears)})`);
  console.log(`elapsed               ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);

  const verdict = await admin.verifyBeforeSwap(target);
  console.log(
    `\nverification          ${verdict.ok ? 'PASS' : 'FAIL'} ` +
      `(candidate ${verdict.candidateDocs} vs live ${verdict.currentDocs})` +
      (verdict.reason ? ` — ${verdict.reason}` : ''),
  );

  if (PROMOTE && verdict.ok && !LIMIT) {
    const previous = await admin.resolveAlias();
    await admin.swapAlias(target);
    console.log(`\nPROMOTED: ${SEARCH_ALIAS} → ${target}`);
    console.log(`rollback: swap ${SEARCH_ALIAS} back to ${previous ?? '(none)'}`);
    if (DROP_OLD && previous && previous !== target) await admin.dropIndex(previous);
  } else if (PROMOTE && LIMIT) {
    console.log('\nNOT promoted: REINDEX_LIMIT is set, so the index is partial.');
  } else if (PROMOTE) {
    console.log('\nNOT promoted: verification failed.');
  } else {
    console.log(
      `\nNot promoted (default). To go live:\n` +
        `  REINDEX_PROMOTE=1 node dist/src/reindex-search-v2.cli.js`,
    );
  }

  await app.close();
  process.exit(stats.failed > stats.indexed * 0.01 ? 1 : 0);
}

main().catch((error) => {
  console.error('[reindex] fatal', error);
  process.exit(1);
});
