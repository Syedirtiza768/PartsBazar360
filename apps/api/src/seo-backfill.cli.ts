/**
 * Backfill SEO state for the existing catalog.
 *
 * Safe to run repeatedly and safe to interrupt: it only ever *adds* a slug to
 * a part that has none, so a second run picks up where the first stopped and
 * can never move a URL that is already published. Nothing here rewrites an
 * existing slug — that is `regenerateSlug`, which is deliberately a separate,
 * audited action.
 *
 * Usage (inside the api container):
 *   node dist/src/seo-backfill.cli.js               # assign missing slugs
 *   node dist/src/seo-backfill.cli.js --dry-run     # report only
 *   node dist/src/seo-backfill.cli.js --report      # health scan, no writes
 *   node dist/src/seo-backfill.cli.js --batch 2000
 *
 * Run it as a standalone container rather than `docker exec` — a long job in
 * an exec session dies when the container is recreated (see the deploy notes).
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { SeoCatalogService } from './modules/seo/seo-catalog.service';
import { SeoHealthService } from './modules/seo/seo-health.service';
import { SeoSlugService } from './modules/seo/seo-slug.service';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const parsed = Number.parseInt(process.argv[index + 1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  const logger = new Logger('SeoBackfill');
  // This standalone job must not prime the request-serving SEO cache. Its
  // aggregate scans would compete with live vehicle and catalog traffic.
  process.env.SEO_CACHE_PRIME = '0';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const slugs = app.get(SeoSlugService);
  const health = app.get(SeoHealthService);
  const catalog = app.get(SeoCatalogService);

  const batchSize = option('batch', 1_000);
  const dryRun = flag('dry-run');
  const reportOnly = flag('report');

  try {
    if (!reportOnly) {
      const pending = await prisma.canonicalPart.count({ where: { slug: null } });
      logger.log(
        `${pending.toLocaleString()} parts without a slug (batch ${batchSize}${dryRun ? ', DRY RUN' : ''})`,
      );

      let processed = 0;
      let assigned = 0;

      // Keyset paging on the primary key. OFFSET would re-walk the whole
      // prefix on every batch, and the set shrinks as we go, so an offset
      // would also skip rows.
      for (;;) {
        const batch = await prisma.canonicalPart.findMany({
          where: { slug: null },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });
        if (!batch.length) break;

        if (dryRun) {
          processed += batch.length;
          logger.log(`[dry-run] would assign ${batch.length} slugs`);
          break;
        }

        const results = await slugs.ensureSlugs(batch.map((row) => row.id));
        processed += batch.length;
        assigned += results.filter((result) => result.created).length;
        logger.log(
          `${processed.toLocaleString()} / ${pending.toLocaleString()} processed, ${assigned.toLocaleString()} assigned`,
        );

        // ensureSlugs never throws per-part; if a whole batch produced nothing
        // the remaining rows are unfixable and looping would spin forever.
        if (results.length === 0) {
          logger.warn('Batch produced no assignments — stopping to avoid a loop');
          break;
        }
      }

      logger.log(`Slug backfill complete: ${assigned.toLocaleString()} assigned`);
      catalog.invalidate();
    }

    // ---- report ---------------------------------------------------------
    const counters = await health.counters();
    logger.log('--- SEO counters ---');
    for (const [key, value] of Object.entries(counters)) {
      logger.log(`  ${key.padEnd(18)} ${Number(value).toLocaleString()}`);
    }

    const scan = await health.scan({ sample: option('sample', 500) });
    logger.log('--- Health (sample) ---');
    logger.log(
      `  scanned ${scan.scanned}  healthy ${scan.healthy}  warning ${scan.warning}  critical ${scan.critical}  indexable ${scan.indexable}`,
    );
    for (const entry of scan.topIssues) {
      logger.log(`  ${String(entry.count).padStart(6)}  ${entry.severity.padEnd(8)} ${entry.code}`);
    }
    for (const entry of scan.catalogIssues) {
      logger.warn(`  ${entry.code}: ${entry.message}`);
    }

    const summary = await app.get(SeoCatalogService).partSitemapChunkCount();
    const indexable = await catalog.countIndexableParts();
    logger.log(
      `--- Sitemap: ${indexable.toLocaleString()} indexable parts across ${summary} chunk(s) ---`,
    );

    const taxonomy = await catalog.listTaxonomy();
    const eligible = taxonomy.filter((node) => node.indexable);
    logger.log(
      `--- Taxonomy: ${eligible.length} indexable of ${taxonomy.length} nodes ---`,
    );
    for (const kind of ['category', 'categoryGroup', 'brand', 'make', 'model']) {
      const count = eligible.filter((node) => node.kind === kind).length;
      const total = taxonomy.filter((node) => node.kind === kind).length;
      logger.log(`  ${kind.padEnd(14)} ${count} / ${total}`);
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => {
    // Nest's `app.close()` does not tear down the BullMQ/Redis connections
    // this context opens, so the event loop stays alive and the CLI hangs
    // after its work is done. Exit explicitly rather than leaving a container
    // running indefinitely.
    process.exit(0);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
