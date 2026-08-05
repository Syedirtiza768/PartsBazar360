#!/usr/bin/env node
// Validate stored dimensional weights on CanonicalPart.
//
// Checks every part with a stored weight or dimensions for plausibility
// against its part-class envelope, and verifies that precomputed
// dimensionalWeightKg / billableWeightKg match what would be derived from
// the stored raw values today.
//
// Usage:
//   node scripts/validate-dimensional-weights.mjs                    # full audit
//   node scripts/validate-dimensional-weights.mjs --dry-run          # same, no writes
//   node scripts/validate-dimensional-weights.mjs --fix              # fix recomputation errors
//   node scripts/validate-dimensional-weights.mjs --outliers-only    # only class-envelope violations
//   node scripts/validate-dimensional-weights.mjs --json             # JSON output for piping
//
// Exit codes: 0 = all clean, 1 = issues found, 2 = runtime error

try { await import('dotenv/config'); } catch {}

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const BATCH_SIZE = 1000;

async function loadFromDist(relativePath, exportNames) {
  const candidates = [
    `/app/dist/src/modules/${relativePath}`,
    `/app/dist/apps/api/src/modules/${relativePath}`,
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
      // next
    }
  }
  throw new Error(
    `Could not load ${exportNames.join(', ')} from ${relativePath} in dist — rebuild the API first.`,
  );
}

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Weight that far exceeds anything in the automotive parts catalogue. */
const ABSURD_WEIGHT_KG = 5000;

/** A single dimension over 10m is almost certainly a unit error (mm → cm). */
const ABSURD_DIM_CM = 1000;

/**
 * Factor by which stored weight can exceed the class max before we flag
 * it as an outlier vs merely "outside envelope".  Exact sources are trusted
 * but not unconditionally — a 50kg sensor is still wrong.
 */
const OUTLIER_FACTOR = 3;

/**
 * Factor below the class min that counts as an outlier.
 * Mirrors PLAU_OUTLIER_FACTOR (=3, i.e. min/3) in billable-weight.util.ts —
 * the authoritative threshold actually used to flag outliers at checkout.
 * Kept as a literal here (not imported) since this script runs as plain ESM
 * outside the compiled dist; update both places together if it ever changes.
 */
const OUTLIER_BELOW_FACTOR = 1 / 3;

// ── Issue Categories ──────────────────────────────────────────────────────────

const IssueType = {
  ABSURD_WEIGHT: 'ABSURD_WEIGHT',
  ABSURD_DIMENSIONS: 'ABSURD_DIMENSIONS',
  WEIGHT_OUTLIER_ABOVE: 'WEIGHT_OUTLIER_ABOVE',
  WEIGHT_OUTLIER_BELOW: 'WEIGHT_OUTLIER_BELOW',
  DIMS_MISSING_BUT_WEIGHT_EXISTS: 'DIMS_MISSING_BUT_WEIGHT_EXISTS',
  DIMENSIONAL_WEIGHT_STALE: 'DIMENSIONAL_WEIGHT_STALE',
  BILLABLE_WEIGHT_STALE: 'BILLABLE_WEIGHT_STALE',
  VOLUMETRIC_CALC_ERROR: 'VOLUMETRIC_CALC_ERROR',
  PART_CLASS_MISMATCH: 'PART_CLASS_MISMATCH',
  NEGATIVE_OR_ZERO_DIMS: 'NEGATIVE_OR_ZERO_DIMS',
  NEGATIVE_WEIGHT: 'NEGATIVE_WEIGHT',
  EXTREME_ASPECT_RATIO: 'EXTREME_ASPECT_RATIO',
};

function severity(type) {
  switch (type) {
    case IssueType.ABSURD_WEIGHT:
    case IssueType.ABSURD_DIMENSIONS:
    case IssueType.NEGATIVE_WEIGHT:
    case IssueType.NEGATIVE_OR_ZERO_DIMS:
      return 'CRITICAL';
    case IssueType.WEIGHT_OUTLIER_ABOVE:
    case IssueType.WEIGHT_OUTLIER_BELOW:
    case IssueType.EXTREME_ASPECT_RATIO:
      return 'WARNING';
    default:
      return 'INFO';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampWeightToClass(weightKg, profile) {
  if (weightKg < profile.minWeightKg) return { kg: profile.minWeightKg, clamped: true };
  if (weightKg > profile.maxWeightKg) return { kg: profile.maxWeightKg, clamped: true };
  return { kg: weightKg, clamped: false };
}

function parseDims(json) {
  if (!json || typeof json !== 'object') return null;
  const l = toPos(json.lengthCm ?? json.length ?? json.l);
  const w = toPos(json.widthCm ?? json.width ?? json.w);
  const h = toPos(json.heightCm ?? json.height ?? json.h);
  if (l === null || w === null || h === null) return null;
  return { l, w, h };
}

function toPos(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function volumetricKg(dims, divisor = 6000) {
  if (!dims) return null;
  return Math.round(((dims.l * dims.w * dims.h) / divisor) * 1000) / 1000;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const fix = process.argv.includes('--fix');
  const dryRun = fix ? false : !process.argv.includes('--no-dry-run');
  const outliersOnly = process.argv.includes('--outliers-only');
  const jsonOutput = process.argv.includes('--json');

  const { resolvePartClassKey, getPartClassProfile } = await loadFromDist(
    'checkout/part-class-weights.js',
    ['resolvePartClassKey', 'getPartClassProfile'],
  );
  const { deriveBillableWeight, parseDimensionsJson, volumetricWeightKg } =
    await loadFromDist('checkout/billable-weight.util.js', [
      'deriveBillableWeight',
      'parseDimensionsJson',
      'volumetricWeightKg',
    ]);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const total = await prisma.canonicalPart.count();
  console.error(`Scanning ${total} parts for dimensional validation…`);

  // ── Aggregate Stats ───────────────────────────────────────────────────────
  const stats = {
    scanned: 0,
    hasWeight: 0,
    hasDims: 0,
    hasWeightSource: 0,
    issuesFound: 0,
    fixesApplied: 0,
    byType: {},
    bySource: {},
    byClass: {},
  };

  const issues = [];
  let cursor = null;

  for (;;) {
    const parts = await prisma.canonicalPart.findMany({
      where: {
        OR: [
          { weight: { not: null } },
          { dimensions: { not: null } },
          { billableWeightKg: { not: null } },
        ],
      },
      select: {
        id: true,
        title: true,
        category: true,
        weight: true,
        weightSource: true,
        weightConfidence: true,
        dimensions: true,
        partClassKey: true,
        dimensionalWeightKg: true,
        billableWeightKg: true,
        manufacturerPartNumber: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (parts.length === 0) break;
    cursor = parts[parts.length - 1].id;

    const updates = [];

    for (const part of parts) {
      stats.scanned++;
      if (part.weight !== null && part.weight > 0) stats.hasWeight++;
      if (part.dimensions !== null) stats.hasDims++;
      if (part.weightSource) stats.hasWeightSource++;

      const partIssues = [];
      const profile = getPartClassProfile(part.partClassKey);
      const expectedClassKey = resolvePartClassKey({
        title: part.title,
        category: part.category,
      });

      // ── 1. Weight sanity ──────────────────────────────────────────────
      if (part.weight !== null) {
        if (part.weight <= 0) {
          partIssues.push({
            type: IssueType.NEGATIVE_WEIGHT,
            detail: `weight=${part.weight}`,
            source: part.weightSource,
          });
        } else if (part.weight > ABSURD_WEIGHT_KG) {
          partIssues.push({
            type: IssueType.ABSURD_WEIGHT,
            detail: `weight=${part.weight}kg (absurd threshold: ${ABSURD_WEIGHT_KG}kg)`,
            source: part.weightSource,
          });
        } else if (
          part.weightSource &&
          !['CLASS_DEFAULT', 'AI'].includes(part.weightSource)
        ) {
          // Outlier check for exact/extrinsic sources
          if (part.weight > profile.maxWeightKg * OUTLIER_FACTOR) {
            partIssues.push({
              type: IssueType.WEIGHT_OUTLIER_ABOVE,
              detail: `weight=${part.weight}kg > ${OUTLIER_FACTOR}x class max ${profile.maxWeightKg}kg (${profile.key})`,
              source: part.weightSource,
            });
          }
          if (part.weight < profile.minWeightKg * OUTLIER_BELOW_FACTOR) {
            partIssues.push({
              type: IssueType.WEIGHT_OUTLIER_BELOW,
              detail: `weight=${part.weight}kg < ${OUTLIER_BELOW_FACTOR * 100}% of class min ${profile.minWeightKg}kg (${profile.key})`,
              source: part.weightSource,
            });
          }
        }
      }

      // ── 2. Dimension sanity ───────────────────────────────────────────
      const dims = parseDims(part.dimensions);
      if (part.dimensions && !dims) {
        partIssues.push({
          type: IssueType.NEGATIVE_OR_ZERO_DIMS,
          detail: `dimensions JSON present but invalid: ${JSON.stringify(part.dimensions)}`,
          source: part.weightSource,
        });
      } else if (dims) {
        const maxSide = Math.max(dims.l, dims.w, dims.h);
        const minSide = Math.min(dims.l, dims.w, dims.h);
        if (maxSide > ABSURD_DIM_CM) {
          partIssues.push({
            type: IssueType.ABSURD_DIMENSIONS,
            detail: `max side ${maxSide}cm > ${ABSURD_DIM_CM}cm threshold (likely mm not cm)`,
            source: part.weightSource,
          });
        }
        if (minSide > 0 && maxSide / minSide > 50) {
          partIssues.push({
            type: IssueType.EXTREME_ASPECT_RATIO,
            detail: `aspect ratio ${Math.round(maxSide / minSide)}:1 — dims ${dims.l}×${dims.w}×${dims.h}cm`,
            source: part.weightSource,
          });
        }
      } else if (part.weight !== null && part.weight > 0) {
        // Has weight but no dimensions — shipping might be misquoting.
        // (bySource is tallied once per issue in the loop below — don't
        // double-count here.)
        if (!outliersOnly) {
          partIssues.push({
            type: IssueType.DIMS_MISSING_BUT_WEIGHT_EXISTS,
            detail: `weight=${part.weight}kg but no dimensions — will use class defaults`,
            source: part.weightSource,
          });
        }
      }

      // ── 3. Part class mismatch ────────────────────────────────────────
      if (part.partClassKey && part.partClassKey !== expectedClassKey) {
        if (!outliersOnly) {
          partIssues.push({
            type: IssueType.PART_CLASS_MISMATCH,
            detail: `stored="${part.partClassKey}" expected="${expectedClassKey}"`,
            source: part.weightSource,
          });
        }
      }

      // ── 4. Stored derived values consistency ──────────────────────────
      const billable = deriveBillableWeight({
        actualKg: part.weight,
        dimensionsCm: dims
          ? { lengthCm: dims.l, widthCm: dims.w, heightCm: dims.h }
          : null,
      });

      if (billable) {
        const expectedVol = billable.volumetricKg;
        const expectedBillable = billable.billableKg;

        // Compare with tolerance for floating point rounding
        if (part.dimensionalWeightKg !== null && expectedVol !== null) {
          if (Math.abs(part.dimensionalWeightKg - expectedVol) > 0.01) {
            partIssues.push({
              type: IssueType.DIMENSIONAL_WEIGHT_STALE,
              detail: `stored=${part.dimensionalWeightKg}kg expected=${expectedVol}kg (diff=${Math.abs(part.dimensionalWeightKg - expectedVol).toFixed(3)})`,
              source: part.weightSource,
            });
          }
        }

        if (part.billableWeightKg !== null) {
          if (Math.abs(part.billableWeightKg - expectedBillable) > 0.01) {
            partIssues.push({
              type: IssueType.BILLABLE_WEIGHT_STALE,
              detail: `stored=${part.billableWeightKg}kg expected=${expectedBillable}kg (diff=${Math.abs(part.billableWeightKg - expectedBillable).toFixed(3)})`,
              source: part.weightSource,
            });
          }
        }

        // Verify the volumetric calculation itself
        if (dims) {
          const recomputedVol = volumetricWeightKg(
            { lengthCm: dims.l, widthCm: dims.w, heightCm: dims.h },
            6000,
          );
          if (
            expectedVol !== null &&
            recomputedVol !== null &&
            Math.abs(expectedVol - recomputedVol) > 0.01
          ) {
            partIssues.push({
              type: IssueType.VOLUMETRIC_CALC_ERROR,
              detail: `deriveBillable=${expectedVol}kg vs direct=${recomputedVol}kg`,
              source: part.weightSource,
            });
          }
        }
      }

      // ── Record issues ─────────────────────────────────────────────────
      if (partIssues.length > 0) {
        stats.issuesFound += partIssues.length;
        for (const issue of partIssues) {
          stats.byType[issue.type] = (stats.byType[issue.type] || 0) + 1;
          stats.bySource[issue.source || 'UNKNOWN'] =
            (stats.bySource[issue.source || 'UNKNOWN'] || 0) + 1;
          stats.byClass[profile.key] = (stats.byClass[profile.key] || 0) + 1;
        }

        issues.push({
          partId: part.id,
          title: part.title,
          mpn: part.manufacturerPartNumber,
          classKey: part.partClassKey,
          weightSource: part.weightSource,
          weight: part.weight,
          dimensions: part.dimensions,
          dimensionalWeightKg: part.dimensionalWeightKg,
          billableWeightKg: part.billableWeightKg,
          issues: partIssues,
        });

        // ── Fix stale derived values ────────────────────────────────────
        if (fix && billable) {
          const fixData = {};
          if (
            part.dimensionalWeightKg !== null &&
            billable.volumetricKg !== null &&
            Math.abs(part.dimensionalWeightKg - billable.volumetricKg) > 0.01
          ) {
            fixData.dimensionalWeightKg = billable.volumetricKg;
          }
          if (
            part.billableWeightKg !== null &&
            Math.abs(part.billableWeightKg - billable.billableKg) > 0.01
          ) {
            fixData.billableWeightKg = billable.billableKg;
          }
          // Fix class key if mismatched
          if (
            part.partClassKey &&
            part.partClassKey !== expectedClassKey &&
            partIssues.some((i) => i.type === IssueType.PART_CLASS_MISMATCH)
          ) {
            fixData.partClassKey = expectedClassKey;
          }

          if (Object.keys(fixData).length > 0) {
            updates.push({ id: part.id, data: fixData });
            stats.fixesApplied++;
          }
        }
      }
    }

    // ── Apply fixes in batch ────────────────────────────────────────────
    if (fix && updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.canonicalPart.update({ where: { id: u.id }, data: u.data }),
        ),
      );
    }

    if (!jsonOutput) {
      console.error(
        `progress scanned=${stats.scanned}/${total} issues=${stats.issuesFound} fixes=${stats.fixesApplied}`,
      );
    }
  }

  // ── Output ──────────────────────────────────────────────────────────────
  const criticalIssues = issues.filter((i) =>
    i.issues.some(
      (x) =>
        severity(x.type) === 'CRITICAL' ||
        x.type === IssueType.WEIGHT_OUTLIER_ABOVE ||
        x.type === IssueType.WEIGHT_OUTLIER_BELOW,
    ),
  );

  const report = {
    summary: {
      total,
      scanned: stats.scanned,
      hasWeight: stats.hasWeight,
      hasDims: stats.hasDims,
      hasWeightSource: stats.hasWeightSource,
      issuesFound: stats.issuesFound,
      criticalOrOutlier: criticalIssues.length,
      fixesApplied: stats.fixesApplied,
    },
    byType: stats.byType,
    bySource: stats.bySource,
    topClasses: Object.entries(stats.byClass)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20),
    sampleIssues: outliersOnly
      ? criticalIssues.slice(0, 100)
      : issues.slice(0, 100),
  };

  if (jsonOutput) {
    // Write full report to file, summary to stdout
    const reportPath = resolve(
      process.cwd(),
      'dimensional-validation-report.json',
    );
    writeFileSync(reportPath, JSON.stringify({ ...report, allIssues: issues }, null, 2));
    console.log(
      JSON.stringify({ ...report, allIssuesFile: reportPath }),
    );
  } else {
    console.log('\n═══ Dimensional Weight Validation Report ═══\n');
    console.log(`Parts scanned:     ${stats.scanned}`);
    console.log(`With weight:       ${stats.hasWeight}`);
    console.log(`With dimensions:   ${stats.hasDims}`);
    console.log(`With source tag:   ${stats.hasWeightSource}`);
    console.log(`Issues found:      ${stats.issuesFound}`);
    console.log(`Critical/outliers: ${criticalIssues.length}`);
    if (fix) console.log(`Fixes applied:     ${stats.fixesApplied}`);

    console.log('\n── Issues by Type ──');
    for (const [type, count] of Object.entries(stats.byType).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${type.padEnd(35)} ${count}  [${severity(type)}]`);
    }

    console.log('\n── Issues by Weight Source ──');
    for (const [source, count] of Object.entries(stats.bySource).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${source.padEnd(20)} ${count}`);
    }

    console.log('\n── Top 15 Classes with Issues ──');
    for (const [cls, count] of Object.entries(stats.byClass)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)) {
      console.log(`  ${cls.padEnd(30)} ${count}`);
    }

    console.log('\n── Sample Critical/Outlier Issues (up to 50) ──');
    for (const issue of criticalIssues.slice(0, 50)) {
      console.log(
        `\n  Part: ${issue.title} (${issue.mpn || 'no MPN'})`,
      );
      console.log(`  ID:   ${issue.partId}`);
      console.log(`  Class: ${issue.classKey || 'unset'} | Source: ${issue.weightSource || 'unset'}`);
      console.log(`  Weight: ${issue.weight}kg | Stored billable: ${issue.billableWeightKg}kg`);
      for (const i of issue.issues) {
        const sev = severity(i.type);
        console.log(`    ${sev === 'CRITICAL' ? '!!' : '⚠ '} [${i.type}] ${i.detail}`);
      }
    }
  }

  await prisma.$disconnect();
  process.exit(stats.issuesFound > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});