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
//   cd /app && node scripts/backfill-part-class-weights.mjs                     # missing class keys only
//   cd /app && node scripts/backfill-part-class-weights.mjs --recompute-all     # recompute ALL parts
//   cd /app && node scripts/backfill-part-class-weights.mjs --dry-run           # preview changes only
//   cd /app && node scripts/backfill-part-class-weights.mjs --recompute-all --validate-weight  # + outlier audit
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const BATCH_SIZE = 500;

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
  const { resolveItemWeight, deriveBillableWeight, parseDimensionsJson } = await loadFromDist(
    'checkout/billable-weight.util.js',
    ['resolveItemWeight', 'deriveBillableWeight', 'parseDimensionsJson'],
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
  const unitErrorLog = [];
  let scanned = 0;
  let updated = 0;
  let flaggedOutliers = 0;
  let unitConversions = 0;
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

      const resolved = resolveItemWeight({
        weightKg: part.weight,
        dimensionsCm: parseDimensionsJson(part.dimensions),
        weightSource: part.weightSource,
        partClassKey,
      });

      const data = {};
      if (part.partClassKey !== partClassKey) data.partClassKey = partClassKey;

      // Persist auto-converted weight
      if (resolved.unitAutoConverted && part.weight !== null) {
        data.weight = resolved.actualKg;
      }

      // Recompute billable weight using corrected values
      const billable = deriveBillableWeight({
        actualKg: resolved.actualKg,
        dimensionsCm: parseDimensionsJson(part.dimensions),
      });
      if (billable) {
        if (part.dimensionalWeightKg !== billable.volumetricKg) {
          data.dimensionalWeightKg = billable.volumetricKg;
        }
        if (part.billableWeightKg !== billable.billableKg) {
          data.billableWeightKg = billable.billableKg;
        }
      }

      // ── Outlier tracking ─────────────────────────────────────────────
      if (resolved.unitAutoConverted) {
        unitConversions++;
        unitErrorLog.push({
          partId: part.id,
          title: part.title,
          source: part.weightSource,
          originalWeightKg: part.weight,
          correctedWeightKg: resolved.actualKg,
          classKey: partClassKey,
        });
        if (unitErrorLog.length <= 50) {
          console.warn(
            `UNIT_FIX ${part.title}: ${part.weight} → ${resolved.actualKg}kg ` +
              `[${part.weightSource}] class=${partClassKey}`,
          );
        }
      } else if (resolved.outlier) {
        flaggedOutliers++;
        const profile = getPartClassProfile(partClassKey);
        outlierLog.push({
          partId: part.id,
          title: part.title,
          source: part.weightSource,
          weightKg: part.weight,
          classKey: partClassKey,
          classMin: profile.minWeightKg,
          classMax: profile.maxWeightKg,
        });
        if (outlierLog.length <= 50) {
          console.warn(
            `OUTLIER ${part.title}: weight=${part.weight}kg ` +
              `[${part.weightSource}] class=${partClassKey} ` +
              `range=[${profile.minWeightKg}-${profile.maxWeightKg}kg]`,
          );
        }
      }

      if (Object.keys(data).length === 0) continue;

      updated++;
      if (!dryRun) {
        await prisma.canonicalPart.update({ where: { id: part.id }, data });
      }
    }

    console.log(
      `progress scanned=${scanned}/${total} updated=${updated} unitFixes=${unitConversions} outliers=${flaggedOutliers}`,
    );
  }

  const topClasses = Object.entries(classCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  const result = {
    scanned,
    updated,
    unitConversions,
    flaggedOutliers,
    dryRun,
    topClasses,
  };

  if (validateWeight || unitConversions > 0 || flaggedOutliers > 0) {
    result.unitErrorLog = unitErrorLog.slice(0, 100);
    result.outlierLog = outlierLog.slice(0, 100);
  }

  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
