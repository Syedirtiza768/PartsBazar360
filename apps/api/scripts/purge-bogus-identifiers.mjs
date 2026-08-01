#!/usr/bin/env node
/**
 * Clear descriptive text out of CanonicalPart.manufacturerPartNumber and
 * CanonicalPart.oeNumbers.
 *
 * Why: the ingest feeds write part-name words into the identifier columns —
 * MPN "BUMPER" on a Porsche vent grille, MPN "AUDI" on a Q7 stone guard,
 * oeNumbers ["BUMPER"] on a BMW E39 cover. In search those columns are the two
 * most heavily boosted fields (manufacturerPartNumber^3, oeNumbers^2) and hold
 * a single short token, so BM25 length normalisation is at maximum for them.
 * The result: for `q=Audi bumper` those five documents took ranks 1-5 and the
 * first genuine Audi bumper landed at 6.
 *
 * The index-time guard in identifier-sanitize.util.ts already keeps this out of
 * OpenSearch. This script fixes the source rows, so the PDP stops printing
 * "BUMPER" as a part number and future reindexes start from clean data.
 *
 * Rule: a real automotive identifier contains at least one digit and is at
 * least 3 characters. Everything else is descriptive text.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless APPLY=1 is set.
 *
 * Usage (inside API container):
 *   node /tmp/purge-bogus-identifiers.mjs              # report only
 *   node /tmp/purge-bogus-identifiers.mjs | tail -40   # report + samples
 *   APPLY=1 node /tmp/purge-bogus-identifiers.mjs      # write
 *
 * Env:
 *   DATABASE_URL  required
 *   APPLY=1       perform writes (default: dry run)
 *   BATCH         rows per page (default 1000)
 *   SAMPLES       distinct bad values to print (default 30)
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const APPLY = process.env.APPLY === '1';
const BATCH = Math.max(100, Number(process.env.BATCH || 1000));
const SAMPLES = Math.max(0, Number(process.env.SAMPLES || 30));

function isIndexableIdentifier(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 3 && /\d/.test(trimmed);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(
    APPLY
      ? '=== PURGE BOGUS IDENTIFIERS (APPLY — writing) ==='
      : '=== PURGE BOGUS IDENTIFIERS (DRY RUN — no writes) ===',
  );

  let cursor = null;
  let scanned = 0;
  let mpnHits = 0;
  let oeHits = 0;
  let oeValuesDropped = 0;
  const badMpn = new Map();
  const badOe = new Map();

  for (;;) {
    const page = await prisma.canonicalPart.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, manufacturerPartNumber: true, oeNumbers: true },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    scanned += page.length;

    for (const part of page) {
      const data = {};

      const mpn = part.manufacturerPartNumber;
      if (mpn != null && !isIndexableIdentifier(mpn)) {
        badMpn.set(mpn, (badMpn.get(mpn) || 0) + 1);
        data.manufacturerPartNumber = null;
        mpnHits++;
      }

      const oe = Array.isArray(part.oeNumbers) ? part.oeNumbers : [];
      const keptOe = oe.filter((v) => isIndexableIdentifier(v));
      if (keptOe.length !== oe.length) {
        for (const v of oe) {
          if (!isIndexableIdentifier(v)) badOe.set(v, (badOe.get(v) || 0) + 1);
        }
        oeValuesDropped += oe.length - keptOe.length;
        data.oeNumbers = keptOe;
        oeHits++;
      }

      if (APPLY && Object.keys(data).length > 0) {
        await prisma.canonicalPart.update({ where: { id: part.id }, data });
      }
    }

    if (scanned % (BATCH * 10) === 0) {
      console.log(`  scanned ${scanned}… mpn=${mpnHits} oe=${oeHits}`);
    }
  }

  const top = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, SAMPLES)
      .map(([value, count]) => `      ${String(count).padStart(6)}  ${JSON.stringify(value)}`)
      .join('\n');

  console.log(`\nScanned parts:               ${scanned}`);
  console.log(`Parts with bogus MPN:        ${mpnHits}`);
  console.log(`Parts with bogus oeNumbers:  ${oeHits}`);
  console.log(`Individual OE values dropped:${oeValuesDropped}`);

  if (badMpn.size) {
    console.log(`\nTop bogus manufacturerPartNumber values (${badMpn.size} distinct):`);
    console.log(top(badMpn));
  }
  if (badOe.size) {
    console.log(`\nTop bogus oeNumbers values (${badOe.size} distinct):`);
    console.log(top(badOe));
  }

  console.log(
    APPLY
      ? '\nDone — writes applied. Reindex next: node /tmp/reindex-active-from-db.mjs'
      : '\nDry run only. Re-run with APPLY=1 to write.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
