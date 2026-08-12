/**
 * Populate `hasImage` on existing search documents.
 *
 * `imageUrls` is mapped `index: false` on the legacy `canonical_parts` index,
 * so image availability was never queryable or sortable. `hasImage` is the
 * indexed projection of it, written on every index operation from now on —
 * this backfills the documents that predate the field so browse can sort
 * imaged listings first immediately, rather than only for parts that happen
 * to be re-indexed later.
 *
 * Runs entirely inside OpenSearch via `_update_by_query`: no documents are
 * re-read from Postgres and nothing is re-ingested, so a 100k-document index
 * is a matter of seconds rather than a full reindex.
 *
 * Idempotent. Safe to re-run, and safe to run while the search outbox is
 * draining — `conflicts: 'proceed'` skips documents another writer touched
 * mid-flight rather than aborting the whole operation.
 *
 * Usage (inside the api container, or as a standalone container):
 *   node dist/src/backfill-has-image.cli.js
 *   node dist/src/backfill-has-image.cli.js --index canonical_parts_v3
 *   node dist/src/backfill-has-image.cli.js --dry-run
 */

import { Client } from '@opensearch-project/opensearch';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

async function main(): Promise<void> {
  const client = new Client({
    node: process.env.OPENSEARCH_URL || 'http://opensearch:9200',
  });

  const index = option('index', 'canonical_parts');
  const dryRun = process.argv.includes('--dry-run');

  // Ensure the field is mapped before writing it. On an index created before
  // this field existed, an unmapped boolean would be dynamically guessed.
  try {
    await client.indices.putMapping({
      index,
      body: { properties: { hasImage: { type: 'boolean' } } },
    });
    // eslint-disable-next-line no-console
    console.log(`[has-image] mapping ensured on ${index}`);
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.warn(`[has-image] putMapping skipped: ${error?.message || error}`);
  }

  const missing = await client.count({
    index,
    body: { query: { bool: { must_not: [{ exists: { field: 'hasImage' } }] } } },
  });
  const missingCount = Number((missing as any)?.body?.count ?? 0);
  // eslint-disable-next-line no-console
  console.log(`[has-image] ${missingCount.toLocaleString()} documents without hasImage`);

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('[has-image] dry run — no writes');
    return;
  }
  if (missingCount === 0) {
    // eslint-disable-next-line no-console
    console.log('[has-image] nothing to do');
    return;
  }

  const started = Date.now();
  const result = await client.updateByQuery({
    index,
    // Skip documents a concurrent indexer changed underneath us instead of
    // failing the whole run.
    conflicts: 'proceed',
    refresh: true,
    body: {
      query: { bool: { must_not: [{ exists: { field: 'hasImage' } }] } },
      script: {
        lang: 'painless',
        // `imageUrls` is a non-indexed source field, so this reads _source
        // rather than doc values — which is exactly why a script is needed.
        source:
          "ctx._source.hasImage = ctx._source.imageUrls != null && ctx._source.imageUrls.size() > 0;",
      },
    },
  });

  const body = (result as any)?.body ?? result;
  // eslint-disable-next-line no-console
  console.log(
    `[has-image] updated ${Number(body.updated ?? 0).toLocaleString()} documents ` +
      `(${Number(body.version_conflicts ?? 0)} conflicts skipped) in ${Math.round((Date.now() - started) / 1000)}s`,
  );

  const withImage = await client.count({
    index,
    body: { query: { term: { hasImage: true } } },
  });
  const withoutImage = await client.count({
    index,
    body: { query: { term: { hasImage: false } } },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[has-image] ${Number((withImage as any)?.body?.count ?? 0).toLocaleString()} with image, ` +
      `${Number((withoutImage as any)?.body?.count ?? 0).toLocaleString()} without`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
