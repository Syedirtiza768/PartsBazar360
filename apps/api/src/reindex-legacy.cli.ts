/**
 * Re-writes parts into the legacy `canonical_parts` index that buyer search
 * (`OpenSearchService.browseParts`) reads.
 *
 * The SearchOutbox worker only writes the v2+/`parts_search` index, so a bulk
 * SQL change followed by outbox rows leaves buyer search showing the old
 * title, brand and makes. This replays those parts through the same
 * `OpenSearchService.indexPart` path that merchant and admin edits use.
 *
 * Read-only against Postgres. Parts are chosen by outbox reason:
 *   REASON=LISTING_AUDIT_2026_11_13 node dist/src/reindex-legacy.cli.js
 * or by explicit ids:
 *   IDS=id1,id2 node dist/src/reindex-legacy.cli.js
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { OpenSearchService } from './modules/search/opensearch.service';

async function main() {
  const reason = process.env.REASON?.trim();
  const explicit = (process.env.IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const batchSize = Math.max(10, Number(process.env.BATCH || 200));
  if (!reason && explicit.length === 0) {
    throw new Error('Set REASON=<SearchOutbox payload reason> or IDS=a,b,c');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const search = app.get(OpenSearchService);

  try {
    let ids = explicit;
    if (reason) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT "entityId" AS id FROM "SearchOutbox"
        WHERE "entityType" = 'CanonicalPart' AND payload->>'reason' = ${reason}`;
      ids = [...new Set([...ids, ...rows.map((r) => r.id)])];
    }
    console.log(`Reindexing ${ids.length} parts into the legacy index`);

    let indexed = 0;
    let missing = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i += batchSize) {
      const slice = ids.slice(i, i + batchSize);
      const parts = await prisma.canonicalPart.findMany({
        where: { id: { in: slice } },
        include: { offers: { include: { seller: true } }, partNumbers: true },
      });
      missing += slice.length - parts.length;
      for (const part of parts) {
        try {
          await search.indexPart(part);
          indexed++;
        } catch (err) {
          failed++;
          console.warn(
            `reindex failed for ${part.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(`${Math.min(i + batchSize, ids.length)}/${ids.length}`);
    }
    console.log(`Done: indexed ${indexed}, missing ${missing}, failed ${failed}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
