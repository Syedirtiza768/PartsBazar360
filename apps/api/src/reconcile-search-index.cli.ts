/**
 * Reconcile PostgreSQL against the search index (brief §19).
 *
 * Finds the drift the audit measured — 139,313 parts with an active offer but
 * only 125,859 indexed documents — and repairs it by enqueueing the difference
 * onto the outbox, so the normal consumer does the writing and every repair is
 * observable and retryable.
 *
 * Reports before it writes. `RECONCILE_APPLY=1` is required to enqueue
 * anything; the default is a dry run.
 *
 *   node dist/src/reconcile-search-index.cli.js                 # report only
 *   RECONCILE_APPLY=1 node dist/src/reconcile-search-index.cli.js
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from '@opensearch-project/opensearch';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { SearchOutboxService } from './modules/search/index/search-outbox.service';
import {
  SEARCH_ALIAS,
  SEARCH_INDEX_VERSION,
  physicalIndexName,
} from './modules/search/index/search-index.schema';

const APPLY = process.env.RECONCILE_APPLY === '1';
const PAGE = Number(process.env.RECONCILE_PAGE || 5000);

async function resolveIndex(client: Client): Promise<string> {
  try {
    const response = await client.indices.existsAlias({ name: SEARCH_ALIAS });
    if (Boolean((response as any)?.body ?? response)) return SEARCH_ALIAS;
  } catch {
    /* fall through */
  }
  return physicalIndexName(SEARCH_INDEX_VERSION);
}

/** Every part id that should be searchable: has at least one ACTIVE offer. */
async function expectedIds(prisma: PrismaService): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.canonicalPart.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      where: { offers: { some: { status: 'ACTIVE' } } },
      select: { id: true },
    });
    if (!rows.length) break;
    for (const row of rows) ids.add(row.id);
    cursor = rows[rows.length - 1].id;
  }
  return ids;
}

/** Every document id currently in the index. */
async function indexedIds(client: Client, index: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let response: any = await client.search({
    index,
    scroll: '2m',
    body: { size: 5000, _source: false, query: { match_all: {} } } as any,
  });

  while (response.body.hits.hits.length) {
    for (const hit of response.body.hits.hits) ids.add(hit._id);
    response = await client.scroll({
      scroll_id: response.body._scroll_id,
      scroll: '2m',
    });
  }
  return ids;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const outbox = app.get(SearchOutboxService);
  const client = new Client({
    node: process.env.OPENSEARCH_URL || 'http://opensearch:9200',
  });

  const index = await resolveIndex(client);
  console.log(`Reconciling against ${index}${APPLY ? '' : '  (DRY RUN)'}\n`);

  const [expected, indexed] = await Promise.all([
    expectedIds(prisma),
    indexedIds(client, index),
  ]);

  // Should be searchable but is not.
  const missing = [...expected].filter((id) => !indexed.has(id));
  // Is searchable but should not be — sold out, suspended seller, deleted.
  const orphaned = [...indexed].filter((id) => !expected.has(id));

  console.log(`expected (active offer)   ${expected.size}`);
  console.log(`in index                  ${indexed.size}`);
  console.log(`missing from index        ${missing.length}`);
  console.log(`orphaned in index         ${orphaned.length}`);

  const outboxStats = await outbox.stats();
  console.log(`\noutbox                    ${JSON.stringify(outboxStats)}`);

  if (missing.length) console.log(`\nsample missing:  ${missing.slice(0, 5).join(', ')}`);
  if (orphaned.length) console.log(`sample orphaned: ${orphaned.slice(0, 5).join(', ')}`);

  if (!APPLY) {
    console.log(
      `\nDry run — nothing enqueued. To repair:\n` +
        `  RECONCILE_APPLY=1 node dist/src/reconcile-search-index.cli.js`,
    );
  } else {
    const upserts = await outbox.enqueueMany(missing, 'UPSERT', 'reconcile:missing');
    const deletes = await outbox.enqueueMany(orphaned, 'DELETE', 'reconcile:orphaned');
    console.log(`\nEnqueued ${upserts} UPSERT and ${deletes} DELETE rows.`);
    console.log('The outbox worker will apply them; re-run this job to verify.');
  }

  await app.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('reconcile failed', error);
  process.exit(1);
});
