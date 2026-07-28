import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BuyerCacheService } from '../search/buyer-cache.service';
import { OpenRouterClient } from '../listing-pipeline/openrouter-client';
import { EnrichmentBudgetService } from './enrichment-budget.service';
import { ENRICHMENT_VERSION } from './enrichment.service';
import { estimateWeight } from './weight-estimator';
import {
  generateInfographicSpec,
  infographicMinPriceUsd,
  INFOGRAPHIC_VERSION,
} from './infographic-spec';
import { resolvePartClassKey } from '../checkout/part-class-weights';
import {
  deriveBillableWeight,
  isExactWeightSource,
  parseDimensionsJson,
} from '../checkout/billable-weight.util';

/**
 * Consumes the `enrichment` queue: fills in shipping weight and dimensions for
 * parts that lack them, then busts the buyer ISR cache so the PDP picks up the
 * better numbers.
 *
 * Concurrency is deliberately low. These jobs are latency-tolerant (the page
 * already rendered an estimate) and the point is to control spend, not to drain
 * the queue quickly.
 */
@Processor('enrichment', {
  concurrency: Number(process.env.ENRICHMENT_CONCURRENCY || 2),
})
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name);
  private client: OpenRouterClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: EnrichmentBudgetService,
    private readonly buyerCache: BuyerCacheService,
  ) {
    super();
  }

  private getClient(): OpenRouterClient {
    if (!this.client) {
      this.client = new OpenRouterClient(process.env.OPENROUTER_API_KEY || '');
    }
    return this.client;
  }

  async process(job: Job<{ partId: string; reason?: string }>) {
    if (job.name !== 'enrich-part') {
      this.logger.warn(`Unknown enrichment job: ${job.name}`);
      return { skipped: true };
    }

    const { partId } = job.data;

    const gate = await this.budget.canSpend();
    if (!gate.allowed) {
      // Not a failure: the part keeps its class estimate and can be retried in a
      // later window. DEFERRED distinguishes this from a genuine error.
      this.logger.log(`Deferring ${partId}: ${gate.reason}`);
      await this.setStatus(partId, 'DEFERRED');
      return { deferred: true, reason: gate.reason };
    }

    const part = await this.prisma.canonicalPart.findUnique({
      where: { id: partId },
      select: {
        id: true,
        title: true,
        brand: true,
        category: true,
        weight: true,
        weightSource: true,
        dimensions: true,
        partClassKey: true,
        oeNumbers: true,
        manufacturerPartNumber: true,
        partSource: true,
        qualityTier: true,
        material: true,
        position: true,
        itemSpecifics: true,
        infographicSpec: true,
        infographicVersion: true,
        offers: {
          where: { status: 'ACTIVE' },
          orderBy: { price: 'desc' },
          take: 1,
          select: { price: true },
        },
      },
    });

    if (!part) {
      this.logger.warn(`Part ${partId} vanished before enrichment`);
      return { skipped: true };
    }

    await this.setStatus(partId, 'RUNNING');

    try {
      const partClassKey =
        part.partClassKey ??
        resolvePartClassKey({ title: part.title, category: part.category });

      // A measured weight outranks anything the model can produce; only fill the
      // gaps around it.
      const weightIsTrusted =
        typeof part.weight === 'number' &&
        part.weight > 0 &&
        isExactWeightSource(part.weightSource);
      const existingDims = parseDimensionsJson(part.dimensions);

      const estimate =
        weightIsTrusted && existingDims
          ? null
          : await estimateWeight(this.getClient(), {
              title: part.title,
              brand: part.brand,
              category: part.category,
              partClassKey,
              oeNumbers: part.oeNumbers,
              manufacturerPartNumber: part.manufacturerPartNumber,
            });

      if (estimate) {
        await this.budget.recordSpend(estimate.costUsd);
      }

      const infographic = await this.maybeBuildInfographic(part, estimate?.weightKg);

      const weightKg = weightIsTrusted
        ? (part.weight as number)
        : (estimate?.weightKg ?? null);
      const dimensionsCm = existingDims ?? estimate?.dimensionsCm ?? null;
      const billable = deriveBillableWeight({
        actualKg: weightKg,
        dimensionsCm,
      });

      await this.prisma.canonicalPart.update({
        where: { id: partId },
        data: {
          partClassKey,
          ...(weightIsTrusted || !estimate
            ? {}
            : {
                weight: estimate.weightKg,
                weightSource: 'AI',
                weightConfidence: estimate.confidence,
              }),
          ...(existingDims || !estimate?.dimensionsCm
            ? {}
            : { dimensions: estimate.dimensionsCm as any }),
          ...(billable
            ? {
                dimensionalWeightKg: billable.volumetricKg,
                billableWeightKg: billable.billableKg,
              }
            : {}),
          ...(infographic
            ? {
                infographicSpec: infographic.spec as any,
                infographicVersion: INFOGRAPHIC_VERSION,
                infographicGeneratedAt: new Date(),
              }
            : {}),
          enrichmentStatus: 'DONE',
          enrichmentVersion: ENRICHMENT_VERSION,
          enrichedAt: new Date(),
          enrichmentSource: estimate
            ? `llm:${estimate.modelId}`
            : 'deterministic',
        },
      });

      if (infographic) {
        await this.linkInfographicMedia(partId, part.title);
      }

      await this.budget.recordSuccess();
      // The PDP cached an estimate; drop it so the better number shows up.
      await this.buyerCache.revalidatePart(partId);

      return {
        partId,
        weightKg,
        dimensionsCm,
        billableWeightKg: billable?.billableKg ?? null,
        model: estimate?.modelId ?? null,
        costUsd: (estimate?.costUsd ?? 0) + (infographic?.costUsd ?? 0),
        confidence: estimate?.confidence ?? null,
        clamped: estimate?.clamped ?? false,
        infographic: Boolean(infographic),
      };
    } catch (err: any) {
      await this.budget.recordFailure();
      // Leave the part on its class estimate rather than a half-written state.
      await this.setStatus(partId, 'FAILED');
      this.logger.error(
        `Enrichment failed for ${partId}: ${err?.message || err}`,
      );
      throw err;
    }
  }

  /**
   * Generates an infographic spec for high-value parts only.
   *
   * The price gate is re-evaluated on every run rather than stored, so a part
   * that later crosses the threshold picks one up on its next enrichment, and a
   * discounted one simply stops being regenerated.
   */
  private async maybeBuildInfographic(
    part: {
      title: string;
      brand: string | null;
      category: string | null;
      partSource: string | null;
      qualityTier: string | null;
      material: string | null;
      position: string | null;
      manufacturerPartNumber: string | null;
      oeNumbers: string[];
      itemSpecifics: unknown;
      infographicSpec: unknown;
      infographicVersion: number;
      offers: { price: number }[];
    },
    weightKg?: number | null,
  ) {
    const topPrice = part.offers[0]?.price ?? 0;
    if (topPrice < infographicMinPriceUsd()) return null;
    // Already current: regenerating would spend money to produce the same card.
    if (part.infographicSpec && part.infographicVersion >= INFOGRAPHIC_VERSION) {
      return null;
    }

    const gate = await this.budget.canSpend();
    if (!gate.allowed) return null;

    const result = await generateInfographicSpec(this.getClient(), {
      title: part.title,
      brand: part.brand,
      category: part.category,
      partSource: part.partSource,
      qualityTier: part.qualityTier,
      manufacturerPartNumber: part.manufacturerPartNumber,
      oeNumbers: part.oeNumbers,
      material: part.material,
      position: part.position,
      itemSpecifics: part.itemSpecifics,
      weightKg,
    });

    if (result) await this.budget.recordSpend(result.costUsd);
    return result;
  }

  /**
   * Publishes the infographic as ProductMedia so the PDP can show it ahead of
   * the seller photos. The URL is same-origin and stable, so it bypasses the
   * image proxy and stays cacheable; freshness is handled by the route's ETag.
   */
  private async linkInfographicMedia(partId: string, title: string) {
    const url = `/api/search/parts/${partId}/infographic.svg`;
    await this.prisma.productMedia
      .upsert({
        where: {
          canonicalPartId_normalizedUrl: {
            canonicalPartId: partId,
            normalizedUrl: url,
          },
        },
        create: {
          canonicalPartId: partId,
          url,
          normalizedUrl: url,
          mediaType: 'INFOGRAPHIC',
          // Negative so it sorts ahead of imported seller photos.
          sortOrder: -1,
          altText: `Specifications for ${title}`.slice(0, 200),
        },
        update: { altText: `Specifications for ${title}`.slice(0, 200) },
      })
      .catch((err: any) =>
        this.logger.warn(
          `Failed to link infographic media for ${partId}: ${err?.message || err}`,
        ),
      );
  }

  private async setStatus(partId: string, status: string) {
    await this.prisma.canonicalPart
      .update({ where: { id: partId }, data: { enrichmentStatus: status } })
      .catch(() => undefined);
  }
}
