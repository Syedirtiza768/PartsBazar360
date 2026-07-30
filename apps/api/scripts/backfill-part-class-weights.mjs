// Backfill shipping class + billable weight on CanonicalPart.
//
// The migration adds partClassKey / dimensionalWeightKg / billableWeightKg but
// cannot populate them: the class is resolved from the title and category by
// TypeScript keyword rules, not SQL. The quote path resolves the class on the
// fly when it is null, so this backfill is about reporting and avoiding repeated
// work rather than correctness.
//
// Loads the compiled resolvers from dist/ so the stored values match exactly
// what the live rate engine computes. Rebuild the API image first.
//
//   cd /app && node scripts/backfill-part-class-weights.mjs
//   cd /app && node scripts/backfill-part-class-weights.mjs --dry-run
//   cd /app && node scripts/backfill-part-class-weights.mjs --recompute-all
//   cd /app && node scripts/backfill-part-class-weights.mjs --recompute-all --validate-weight
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const BATCH_SIZE = 1000;

/**
 * Parts with exact-source weights that exceed this factor above the class max
 * are flagged and tracked. Not clamped (exact sources are trusted), but counted.
 */
const OUTLIER_FLAG_FACTOR = 5;

// ── Weight source classification ──────────────────────────────────────────────
const EXACT_SOURCES = new Set(['SPREADSHEET', 'SELLER', 'MEASURED']);

async function loadFromDist(relativePath, exportNames) {
  const candidates = [
    `/app/dist/src/modules/${relativePath}`,
    `/app/dist/apps/api/src/modules/${relativePath}`,
    // Local runs against ts-node output or a plain `npm run build`.
    resolve(process.cwd(), 'dist/src/modules', relativePath),
    resolve(process.cwd(), 'dist/apps/api/src/modules', relativePath),
  ];
  for (const candidate of candidates) {
    try {
      const mod = await import(pathToFileURL(resolve(candidate)).href);
      if (exportNames.every((name) => typeof mod[name] === 'function')) {
        return mod;
      }
    } catch {
      // Try the next candidate path.
    }
  }
  throw new Error(
    `Could not load ${exportNames.join(', ')} from ${relativePath} in dist — rebuild the API first.`,
  );
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const dryRun = process.argv.includes('--dry-run');
  const recomputeAll = process.argv.includes('--recompute-all');
  const validateWeight = process.argv.includes('--validate-weight');

  const { resolvePartClassKey, getPartClassProfile } = await loadFromDist(
    'checkout/part-class-weights.js',
    ['resolvePartClassKey', 'getPartClassProfile'],
  );
  const { deriveBillableWeight, parseDimensionsJson } = await loadFromDist(
    'checkout/billable-weight.util.js',
    ['deriveBillableWeight', 'parseDimensionsJson'],
  );

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const where = recomputeAll ? {} : { partClassKey: null };
  const total = await prisma.canonicalPart.count({ where });
  console.log(
    JSON.stringify({
      mode: recomputeAll ? 'recompute-all' : 'missing-only',
      dryRun,
      validateWeight,
      total,
    }),
  );

  const classCounts = {};
  const outlierLog = [];
  let scanned = 0;
  let updated = 0;
  let flaggedOutliers = 0;
  let cursor = null;

  for (;;) {
    const parts = await prisma.canonicalPart.findMany({
      where,
      select: {
        id: true,
        title: true,
        category: true,
        weight: true,
        weightSource: true,
        dimensions: true,
        partClassKey: true,
        dimensionalWeightKg: true,
        billableWeightKg: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (parts.length === 0) break;
    cursor = parts[parts.length - 1].id;

    for (const part of parts) {
      scanned++;
      const partClassKey = resolvePartClassKey({
        title: part.title,
        category: part.category,
      });
      classCounts[partClassKey] = (classCounts[partClassKey] || 0) + 1;

      const billable = deriveBillableWeight({
        actualKg: part.weight,
        dimensionsCm: parseDimensionsJson(part.dimensions),
      });

      const data = {};
      if (part.partClassKey !== partClassKey) data.partClassKey = partClassKey;
      if (billable) {
        if (part.dimensionalWeightKg !== billable.volumetricKg) {
          data.dimensionalWeightKg = billable.volumetricKg;
        }
        if (part.billableWeightKg !== billable.billableKg) {
          data.billableWeightKg = billable.billableKg;
        }
      }

      // ── Weight validation against class envelope ──────────────────────
      if (
        validateWeight &&
        part.weight !== null &&
        part.weight > 0 &&
        EXACT_SOURCES.has(part.weightSource)
      ) {
        const profile = getPartClassProfile(partClassKey);
        const isOutlier =
          part.weight > profile.maxWeightKg * OUTLIER_FLAG_FACTOR ||
          part.weight < profile.minWeightKg / OUTLIER_FLAG_FACTOR;

        if (isOutlier) {
          flaggedOutliers++;
          const entry = {
            partId: part.id,
            title: part.title,
            source: part.weightSource,
            weightKg: part.weight,
            classKey: partClassKey,
            classMax: profile.maxWeightKg,
            classMin: profile.minWeightKg,
            flag: `>${OUTLIER_FLAG_FACTOR}x outside envelope`,
          };
          outlierLog.push(entry);
          if (outlierLog.length <= 50) {
            console.warn(
              `OUTLIER ${part.title}: weight=${part.weight}kg ` +
                `[${part.weightSource}] class=${partClassKey} ` +
                `range=[${profile.minWeightKg}-${profile.maxWeightKg}kg]`,
            );
          }
        }
      }

      if (Object.keys(data).length === 0) continue;

      updated++;
      if (!dryRun) {
        await prisma.canonicalPart.update({ where: { id: part.id }, data });
      }
    }

    console.log(`progress scanned=${scanned}/${total} updated=${updated} outliers=${flaggedOutliers}`);
  }

  const topClasses = Object.entries(classCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  const result = {
    scanned,
    updated,
    dryRun,
    topClasses,
  };

  if (validateWeight) {
    result.flaggedOutliers = flaggedOutliers;
    result.outlierSummary = outlierLog.slice(0, 100);
  }

  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
