import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  resolvePartClassKey,
  getPartClassProfile,
} from '../checkout/part-class-weights';
import {
  deriveBillableWeight,
  isExactWeightSource,
  parseDimensionsJson,
  resolveItemWeight,
  volumetricDivisorFromEnv,
  estimatedVolumetricFactorFromEnv,
  type WeightSource,
} from '../checkout/billable-weight.util';

export interface WeightAuditSummary {
  totalParts: number;
  noWeightNoDims: number;
  noWeight: number;
  noDims: number;
  noPartClassKey: number;
  partGeneric: number;
  billableStale: number;
  unitErrorsCorrected: number;
  freightParts: number;
  bySource: Record<string, { count: number; avgWeight: number }>;
  byClass: Array<{ partClassKey: string; count: number }>;
}

export interface RectifyResult {
  scanned: number;
  updated: number;
  unitErrorsFixed: number;
  classKeysAssigned: number;
  billablesRecomputed: number;
  freightParts: number;
}

@Injectable()
export class WeightRectifierService {
  private readonly logger = new Logger(WeightRectifierService.name);
  private readonly divisor = volumetricDivisorFromEnv();
  private readonly estimatedFactor = estimatedVolumetricFactorFromEnv();

  constructor(private readonly prisma: PrismaService) {}

  async audit(): Promise<WeightAuditSummary> {
    const [
      totalParts,
      noWeightNoDims,
      noWeight,
      noDims,
      noPartClassKey,
      partGeneric,
      billableStale,
      freightParts,
      sourceRows,
      classRows,
    ] = await Promise.all([
      this.prisma.canonicalPart.count(),
      this.prisma.canonicalPart.count({
        where: { weight: null, dimensions: { equals: null } },
      }),
      this.prisma.canonicalPart.count({ where: { weight: null } }),
      this.prisma.canonicalPart.count({ where: { dimensions: { equals: null } } }),
      this.prisma.canonicalPart.count({ where: { partClassKey: null } }),
      this.prisma.canonicalPart.count({
        where: { partClassKey: 'PART_GENERIC' },
      }),
      this.prisma.$queryRawUnsafe<Array<{ cnt: number }>>(`
        SELECT COUNT(*)::int as cnt FROM "CanonicalPart"
        WHERE "billableWeightKg" IS NOT NULL AND weight IS NOT NULL
        AND "billableWeightKg" < weight * 0.5
      `),
      this.prisma.canonicalPart.count({
        where: { billableWeightKg: { gt: 30 } },
      }),
      this.prisma.$queryRawUnsafe<
        Array<{ weightSource: string | null; cnt: number; avg: number }>
      >(`
        SELECT "weightSource", COUNT(*)::int as cnt,
               ROUND(AVG(weight)::numeric, 3) as avg
        FROM "CanonicalPart"
        WHERE weight IS NOT NULL
        GROUP BY "weightSource"
      `),
      this.prisma.$queryRawUnsafe<
        Array<{ partClassKey: string | null; cnt: number }>
      >(`
        SELECT "partClassKey", COUNT(*)::int as cnt
        FROM "CanonicalPart"
        GROUP BY "partClassKey"
        ORDER BY cnt DESC
        LIMIT 30
      `),
    ]);

    const bySource: Record<string, { count: number; avgWeight: number }> = {};
    for (const row of sourceRows) {
      const key = row.weightSource ?? 'NULL';
      bySource[key] = { count: row.cnt, avgWeight: Number(row.avg) };
    }

    return {
      totalParts,
      noWeightNoDims,
      noWeight,
      noDims,
      noPartClassKey,
      partGeneric,
      billableStale: billableStale[0]?.cnt ?? 0,
      unitErrorsCorrected: 0,
      freightParts,
      bySource,
      byClass: classRows.map((r) => ({
        partClassKey: r.partClassKey ?? 'NULL',
        count: r.cnt,
      })),
    };
  }

  async rectifyAll(batchSize = 500): Promise<RectifyResult> {
    const stats: RectifyResult = {
      scanned: 0,
      updated: 0,
      unitErrorsFixed: 0,
      classKeysAssigned: 0,
      billablesRecomputed: 0,
      freightParts: 0,
    };

    let cursor: string | null = null;

    for (;;) {
      const parts = await this.prisma.canonicalPart.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
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
        },
      });

      if (parts.length === 0) break;
      cursor = parts[parts.length - 1].id;

      for (const part of parts) {
        stats.scanned++;
        const patch = this.rectifyOne(part);
        if (patch) {
          await this.prisma.canonicalPart.update({
            where: { id: part.id },
            data: patch.data,
          });
          stats.updated++;
          if (patch.flags.unitErrorCorrected) stats.unitErrorsFixed++;
          if (patch.flags.classKeyAssigned) stats.classKeysAssigned++;
          if (patch.flags.billableRecomputed) stats.billablesRecomputed++;
          if ((patch.data.billableWeightKg as number) > 30)
            stats.freightParts++;
        }
      }

      if (stats.scanned % 5000 === 0) {
        this.logger.log(
          `Weight rectifier progress: ${stats.scanned} scanned, ${stats.updated} updated`,
        );
      }
    }

    this.logger.log(
      `Weight rectifier complete: ${stats.scanned} scanned, ${stats.updated} updated, ` +
        `${stats.unitErrorsFixed} unit errors fixed, ${stats.classKeysAssigned} class keys assigned, ` +
        `${stats.billablesRecomputed} billables recomputed, ${stats.freightParts} freight parts`,
    );

    return stats;
  }

  rectifyOne(part: {
    id: string;
    title: string | null;
    category: string | null;
    weight: number | null;
    weightSource: string | null;
    weightConfidence: number | null;
    dimensions: unknown;
    partClassKey: string | null;
    dimensionalWeightKg: number | null;
    billableWeightKg: number | null;
  }): { data: Record<string, unknown>; flags: RectifyFlags } | null {
    const data: Record<string, unknown> = {};
    const flags: RectifyFlags = {
      unitErrorCorrected: false,
      classKeyAssigned: false,
      billableRecomputed: false,
    };
    let dirty = false;

    const currentKey = part.partClassKey ?? 'PART_GENERIC';
    const resolvedKey = resolvePartClassKey({
      title: part.title,
      category: part.category,
    });
    if (resolvedKey !== currentKey) {
      data.partClassKey = resolvedKey;
      dirty = true;
      flags.classKeyAssigned = true;
    }

    const effectiveClassKey = (data.partClassKey as string) ?? currentKey;
    const profile = getPartClassProfile(effectiveClassKey);

    let effectiveWeight = part.weight;
    if (
      effectiveWeight !== null &&
      effectiveWeight > 0 &&
      isExactWeightSource(part.weightSource)
    ) {
      const UNIT_ERROR_FACTOR = 10;
      const PLAU_OUTLIER_FACTOR = 3;
      if (
        effectiveWeight > profile.maxWeightKg * UNIT_ERROR_FACTOR &&
        effectiveWeight / 1000 >= profile.minWeightKg * 0.1 &&
        effectiveWeight / 1000 <= profile.maxWeightKg * PLAU_OUTLIER_FACTOR
      ) {
        effectiveWeight =
          Math.round((effectiveWeight / 1000) * 1000) / 1000;
        data.weight = effectiveWeight;
        data.weightConfidence = 0.5;
        dirty = true;
        flags.unitErrorCorrected = true;
        this.logger.warn(
          `Unit error corrected: ${part.id} ${part.weight} → ${effectiveWeight}kg [${effectiveClassKey}]`,
        );
      }
    }

    const dimensionsCm = parseDimensionsJson(part.dimensions);
    const resolved = resolveItemWeight({
      weightKg: effectiveWeight,
      dimensionsCm,
      weightSource: part.weightSource as WeightSource | null,
      partClassKey: effectiveClassKey,
      divisor: this.divisor,
      estimatedVolumetricFactor: this.estimatedFactor,
    });

    const billable = deriveBillableWeight({
      actualKg: resolved.actualKg,
      dimensionsCm,
      divisor: this.divisor,
    });

    if (billable) {
      const oldBillable = part.billableWeightKg;
      const oldVolumetric = part.dimensionalWeightKg;

      if (
        oldBillable === null ||
        oldVolumetric === null ||
        Math.abs((oldBillable ?? 0) - billable.billableKg) > 0.01 ||
        Math.abs((oldVolumetric ?? 0) - (billable.volumetricKg ?? 0)) > 0.01
      ) {
        data.dimensionalWeightKg = billable.volumetricKg;
        data.billableWeightKg = billable.billableKg;
        dirty = true;
        flags.billableRecomputed = true;
      }
    }

    if (!dirty) return null;
    return { data, flags };
  }
}

interface RectifyFlags {
  unitErrorCorrected: boolean;
  classKeyAssigned: boolean;
  billableRecomputed: boolean;
}
