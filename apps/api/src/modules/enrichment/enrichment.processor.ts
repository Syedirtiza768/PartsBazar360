import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BuyerCacheService } from '../search/buyer-cache.service';
import { OpenRouterClient } from '../listing-pipeline/openrouter-client';
import { EnrichmentBudgetService } from './enrichment-budget.service';
import { ENRICHMENT_VERSION } from './enrichment.service';
import { estimateWeight } from './weight-estimator';
import { generateItemSpecifics } from './item-specifics-generator';
import {
  generateInfographicSpec,
  infographicMinPriceUsd,
  INFOGRAPHIC_VERSION,
} from './infographic-spec';
import {
  buildListingDataFromPart,
  generateLocationDiagram,
  locationDiagramExists,
  locationDiagramMinPriceUsd,
  resolveLocationDiagramSource,
} from './location-diagram';
import { resolvePartClassKey } from '../checkout/part-class-weights';
import {
  deriveBillableWeight,
  isExactWeightSource,
  parseDimensionsJson,
} from '../checkout/billable-weight.util';

/**
 * Consumes the `enrichment` queue: fills shipping weight/dimensions, item
 * specifics, and (for high-value parts) location-diagram + SVG infographic.
 * Busts the buyer ISR cache when done so the PDP picks up the better data.
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
        genuineOemPartNumber: true,
        partSource: true,
        qualityTier: true,
        material: true,
        position: true,
        vehicleSystem: true,
        description: true,
        itemSpecifics: true,
        imageUrls: true,
        infographicSpec: true,
        infographicVersion: true,
        offers: {
          where: { status: 'ACTIVE' },
          orderBy: { price: 'desc' },
          take: 1,
          select: { price: true },
        },
        media: {
          orderBy: { sortOrder: 'asc' },
          take: 12,
          select: { url: true, mediaType: true },
        },
        fitments: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            vehicleConfig: {
              select: {
                trim: true,
                engine: true,
                generation: {
                  select: {
                    startYear: true,
                    model: {
                      select: {
                        name: true,
                        make: { select: { name: true, displayName: true } },
                      },
                    },
                  },
                },
              },
            },
          },
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
      // Version bumps must not re-spend on weight when we already have an AI
      // answer; item specifics / diagrams are the new work.
      const skipWeightCall =
        (weightIsTrusted && Boolean(existingDims)) ||
        (typeof part.weight === 'number' &&
          part.weight > 0 &&
          Boolean(existingDims) &&
          part.weightSource === 'AI');

      const estimate = skipWeightCall
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

      const itemSpecifics = await this.maybeBuildItemSpecifics(part);

      const mergedSpecifics =
        itemSpecifics?.flat ??
        (part.itemSpecifics &&
        typeof part.itemSpecifics === 'object' &&
        !Array.isArray(part.itemSpecifics)
          ? (part.itemSpecifics as Record<string, unknown>)
          : null);

      const locationDiagram = await this.maybeBuildLocationDiagram(
        part,
        mergedSpecifics,
      );

      const infographic = await this.maybeBuildInfographic(
        {
          ...part,
          itemSpecifics: mergedSpecifics ?? part.itemSpecifics,
          position: itemSpecifics?.position ?? part.position,
          material: itemSpecifics?.material ?? part.material,
        },
        estimate?.weightKg,
      );

      const weightKg = weightIsTrusted
        ? (part.weight as number)
        : (estimate?.weightKg ?? null);
      const dimensionsCm = existingDims ?? estimate?.dimensionsCm ?? null;
      const billable = deriveBillableWeight({
        actualKg: weightKg,
        dimensionsCm,
      });

      const sourceBits = [
        estimate ? `weight:${estimate.modelId}` : null,
        itemSpecifics ? `specs:${itemSpecifics.modelId}` : null,
        locationDiagram ? `diagram:${locationDiagram.modelId}` : null,
        infographic ? `infographic` : null,
      ].filter(Boolean);

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
          ...(itemSpecifics
            ? {
                itemSpecifics: itemSpecifics.flat as any,
                ...(itemSpecifics.position
                  ? { position: itemSpecifics.position }
                  : {}),
                ...(itemSpecifics.material
                  ? { material: itemSpecifics.material }
                  : {}),
                ...(itemSpecifics.vehicleSystem
                  ? { vehicleSystem: itemSpecifics.vehicleSystem }
                  : {}),
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
          enrichmentSource: sourceBits.length
            ? `llm:${sourceBits.join('+')}`
            : 'deterministic',
        },
      });

      if (locationDiagram) {
        await this.linkLocationDiagramMedia(
          partId,
          part.title,
          locationDiagram.publicUrl,
          locationDiagram.mode,
        );
      }
      if (infographic) {
        await this.linkInfographicMedia(partId, part.title);
      }

      await this.budget.recordSuccess();
      // The PDP cached an estimate; drop it so the better number shows up.
      await this.buyerCache.revalidatePart(partId);

      const costUsd =
        (estimate?.costUsd ?? 0) +
        (itemSpecifics?.costUsd ?? 0) +
        (locationDiagram?.costUsd ?? 0) +
        (infographic?.costUsd ?? 0);

      return {
        partId,
        weightKg,
        dimensionsCm,
        billableWeightKg: billable?.billableKg ?? null,
        model: estimate?.modelId ?? null,
        costUsd,
        confidence: estimate?.confidence ?? null,
        clamped: estimate?.clamped ?? false,
        itemSpecifics: Boolean(itemSpecifics),
        locationDiagram: locationDiagram?.mode ?? null,
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

  private async maybeBuildItemSpecifics(part: {
    itemSpecifics: unknown;
    title: string;
    brand: string | null;
    manufacturerPartNumber: string | null;
    oeNumbers: string[];
    category: string | null;
    description: string | null;
    partSource: string | null;
    qualityTier: string | null;
    fitments: Array<{
      vehicleConfig: {
        trim: string | null;
        engine: string | null;
        generation: {
          startYear: number | null;
          model: {
            name: string;
            make: { name: string; displayName: string | null } | null;
          } | null;
        } | null;
      } | null;
    }>;
  }) {
    if (part.itemSpecifics) return null;

    const gate = await this.budget.canSpend();
    if (!gate.allowed) return null;

    const result = await generateItemSpecifics(this.getClient(), {
      title: part.title,
      brand: part.brand,
      manufacturerPartNumber: part.manufacturerPartNumber,
      oeNumbers: part.oeNumbers,
      category: part.category,
      description: part.description,
      partSource: part.partSource,
      qualityTier: part.qualityTier,
      compatibility: part.fitments.map((f) => {
        const vc = f.vehicleConfig;
        const gen = vc?.generation;
        return {
          year: gen?.startYear,
          make: gen?.model?.make?.displayName || gen?.model?.make?.name,
          model: gen?.model?.name,
          trim: vc?.trim,
          engine: vc?.engine,
        };
      }),
    });

    if (result) await this.budget.recordSpend(result.costUsd);
    return result;
  }

  private async maybeBuildLocationDiagram(
    part: {
      id: string;
      title: string;
      brand: string | null;
      category: string | null;
      manufacturerPartNumber: string | null;
      genuineOemPartNumber: string | null;
      oeNumbers: string[];
      position: string | null;
      imageUrls: string[];
      media: Array<{ url: string; mediaType: string | null }>;
      fitments: Array<{
        vehicleConfig: {
          trim: string | null;
          engine: string | null;
          generation: {
            startYear: number | null;
            model: {
              name: string;
              make: { name: string; displayName: string | null } | null;
            } | null;
          } | null;
        } | null;
      }>;
      offers: { price: number }[];
    },
    itemSpecifics: Record<string, unknown> | null,
  ) {
    const topPrice = part.offers[0]?.price ?? 0;
    if (topPrice < locationDiagramMinPriceUsd()) return null;

    // Already on disk from a prior run at this prompt generation.
    if (await locationDiagramExists(part.id)) return null;

    const gate = await this.budget.canSpend();
    if (!gate.allowed) return null;

    const callout =
      pickSpecString(itemSpecifics, 'diagramCallout', 'calloutNumber') || null;
    const source = resolveLocationDiagramSource({
      media: part.media,
      imageUrls: part.imageUrls,
      calloutNumber: callout,
    });
    if (!source) return null;

    const vc = part.fitments[0]?.vehicleConfig;
    const gen = vc?.generation;
    const listing = buildListingDataFromPart({
      title: part.title,
      partName:
        pickSpecString(itemSpecifics, 'partType', 'partName') ||
        part.category ||
        part.title,
      oemPartNumber:
        part.genuineOemPartNumber ||
        part.manufacturerPartNumber ||
        part.oeNumbers[0] ||
        pickSpecString(itemSpecifics, 'oeNumber', 'mpn') ||
        null,
      calloutNumber: callout,
      year: gen?.startYear,
      make:
        gen?.model?.make?.displayName ||
        gen?.model?.make?.name ||
        part.brand,
      model: gen?.model?.name,
      trim: vc?.trim,
      engine: vc?.engine,
      partPosition:
        pickSpecString(
          itemSpecifics,
          'partPosition',
          'position',
          'placementOnVehicle',
        ) || part.position,
      quantityIncluded: Number(itemSpecifics?.quantityIncluded) || 1,
      otherIncluded: pickSpecString(itemSpecifics, 'features') || 'None',
    });

    const result = await generateLocationDiagram(this.getClient(), {
      partId: part.id,
      source,
      listing,
    });
    if (result) await this.budget.recordSpend(result.costUsd);
    return result;
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

  private async linkLocationDiagramMedia(
    partId: string,
    title: string,
    url: string,
    mode: string,
  ) {
    const alt =
      mode === 'oem_callout'
        ? `Part location diagram for ${title}`.slice(0, 200)
        : `Illustrative location guide for ${title}`.slice(0, 200);

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
          mediaType: 'LOCATION_DIAGRAM',
          // Ahead of the SVG infographic (−1) and seller photos.
          sortOrder: -2,
          altText: alt,
        },
        update: { altText: alt, mediaType: 'LOCATION_DIAGRAM', sortOrder: -2 },
      })
      .catch((err: any) =>
        this.logger.warn(
          `Failed to link location diagram for ${partId}: ${err?.message || err}`,
        ),
      );
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

function pickSpecString(
  specs: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!specs) return null;
  for (const key of keys) {
    const v = specs[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}
