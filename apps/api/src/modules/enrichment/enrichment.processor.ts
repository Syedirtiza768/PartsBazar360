import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BuyerCacheService } from '../search/buyer-cache.service';
import { RealTrackService } from '../integration/realtrack.service';
import { OpenRouterClient } from '../listing-pipeline/openrouter-client';
import { EnrichmentBudgetService } from './enrichment-budget.service';
import { ENRICHMENT_VERSION } from './enrichment.service';
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
import { mapTradingEnrichmentPayload } from './realtrack-enrichment.mapper';
import { resolvePartClassKey } from '../checkout/part-class-weights';
import {
  deriveBillableWeight,
  isExactWeightSource,
  parseDimensionsJson,
} from '../checkout/billable-weight.util';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Background enrichment consumer.
 *
 * Default provider is RealTrack trading-enrichment (item specifics + shipping
 * metrics). AI is only used for ≥$300 location-diagram PNG + SVG infographic.
 * The PDP paints immediately and polls until this job lands.
 */
@Processor('enrichment', {
  concurrency: Number(process.env.ENRICHMENT_CONCURRENCY || 2),
})
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name);
  private openRouter: OpenRouterClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: EnrichmentBudgetService,
    private readonly buyerCache: BuyerCacheService,
    private readonly realTrack: RealTrackService,
  ) {
    super();
  }

  private get diagramsEnabled(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY);
  }

  private getClient(): OpenRouterClient {
    if (!this.openRouter) {
      this.openRouter = new OpenRouterClient(process.env.OPENROUTER_API_KEY || '');
    }
    return this.openRouter;
  }

  async process(job: Job<{ partId: string; reason?: string }>) {
    if (job.name !== 'enrich-part') {
      this.logger.warn(`Unknown enrichment job: ${job.name}`);
      return { skipped: true };
    }

    const { partId } = job.data;

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
          orderBy: [{ updatedAt: 'desc' }, { price: 'desc' }],
          take: 3,
          select: {
            price: true,
            externalOfferId: true,
            sourceKey: true,
          },
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

      const rtListingId = this.resolveRealTrackListingId(part.offers);
      if (!rtListingId) {
        await this.setStatus(partId, 'FAILED');
        this.logger.warn(
          `No RealTrack listing id for ${partId} — cannot trading-enrich`,
        );
        return { skipped: true, reason: 'no_realtrack_listing_id' };
      }

      let rtPayload: unknown;
      try {
        try {
          const budget = await this.realTrack.fetchTradingEnrichmentBudget();
          const remaining = Number(budget?.remaining);
          if (Number.isFinite(remaining) && remaining <= 0) {
            await this.setStatus(partId, 'DEFERRED');
            this.logger.warn(
              `RealTrack enrichment budget exhausted — deferring ${partId}`,
            );
            return { deferred: true, reason: 'budget_exhausted' };
          }
        } catch (budgetErr: any) {
          this.logger.debug(
            `Budget check skipped: ${budgetErr?.message || budgetErr}`,
          );
        }

        rtPayload = await this.realTrack.fetchTradingEnrichment(rtListingId);
      } catch (err: any) {
        const msg = err?.message || String(err);
        // Endpoint not deployed yet, or rate-limited: defer rather than poison.
        if (/404|429|503|502/.test(msg)) {
          await this.setStatus(partId, 'DEFERRED');
          this.logger.warn(`RealTrack enrichment deferred for ${partId}: ${msg}`);
          return { deferred: true, reason: msg };
        }
        throw err;
      }

      const mapped = mapTradingEnrichmentPayload(rtPayload);

      const weightIsTrusted =
        typeof part.weight === 'number' &&
        part.weight > 0 &&
        isExactWeightSource(part.weightSource);
      const existingDims = parseDimensionsJson(part.dimensions);

      const weightKg = weightIsTrusted
        ? (part.weight as number)
        : (mapped.weightKg ?? part.weight ?? null);
      const dimensionsCm = existingDims ?? mapped.dimensionsCm ?? null;
      const billable = deriveBillableWeight({
        actualKg: weightKg,
        dimensionsCm,
      });

      const itemSpecifics =
        mapped.itemSpecifics ||
        (part.itemSpecifics &&
        typeof part.itemSpecifics === 'object' &&
        !Array.isArray(part.itemSpecifics)
          ? (part.itemSpecifics as Record<string, unknown>)
          : null);

      // Trading gallery is authoritative — put it first, keep any extras.
      const imageUrls =
        mapped.imageUrls && mapped.imageUrls.length
          ? [
              ...mapped.imageUrls,
              ...(part.imageUrls || []).filter(
                (u) => !mapped.imageUrls!.includes(u),
              ),
            ]
          : null;

      // Diagrams still use OpenRouter; gated separately so RT failures don't
      // depend on the AI daily budget.
      const locationDiagram = this.diagramsEnabled
        ? await this.maybeBuildLocationDiagram(
            {
              ...part,
              imageUrls: imageUrls || part.imageUrls,
              position: mapped.position || part.position,
            },
            itemSpecifics,
          )
        : null;

      const infographic = this.diagramsEnabled
        ? await this.maybeBuildInfographic(
            {
              ...part,
              itemSpecifics: itemSpecifics ?? part.itemSpecifics,
              position: mapped.position || part.position,
              material: mapped.material || part.material,
              brand: mapped.brand || part.brand,
              manufacturerPartNumber:
                mapped.manufacturerPartNumber || part.manufacturerPartNumber,
              oeNumbers: mapped.oeNumbers || part.oeNumbers,
            },
            weightKg,
          )
        : null;

      await this.prisma.canonicalPart.update({
        where: { id: partId },
        data: {
          partClassKey,
          ...(mapped.brand ? { brand: mapped.brand } : {}),
          // Trading description is the full eBay HTML — prefer it whenever present.
          ...(mapped.description ? { description: mapped.description } : {}),
          ...(mapped.manufacturerPartNumber
            ? { manufacturerPartNumber: mapped.manufacturerPartNumber }
            : {}),
          ...(mapped.oeNumbers?.length ? { oeNumbers: mapped.oeNumbers } : {}),
          ...(imageUrls ? { imageUrls } : {}),
          ...(mapped.compatibility
            ? { compatibility: mapped.compatibility as any }
            : {}),
          ...(!weightIsTrusted && mapped.weightKg
            ? {
                weight: mapped.weightKg,
                weightSource: 'SELLER',
                weightConfidence: mapped.rawCached === false ? 0.85 : 0.95,
              }
            : {}),
          ...(!existingDims && mapped.dimensionsCm
            ? { dimensions: mapped.dimensionsCm as any }
            : {}),
          ...(billable
            ? {
                dimensionalWeightKg: billable.volumetricKg,
                billableWeightKg: billable.billableKg,
              }
            : {}),
          ...(itemSpecifics
            ? {
                itemSpecifics: itemSpecifics as any,
                ...(mapped.position ? { position: mapped.position } : {}),
                ...(mapped.material ? { material: mapped.material } : {}),
                ...(mapped.vehicleSystem
                  ? { vehicleSystem: mapped.vehicleSystem }
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
          enrichmentSource: `realtrack:trading-enrichment${
            mapped.rawCached ? ':cached' : ''
          }${locationDiagram ? '+diagram' : ''}${infographic ? '+infographic' : ''}`,
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

      await this.buyerCache.revalidatePart(partId);

      return {
        partId,
        provider: 'realtrack',
        rtListingId,
        cached: mapped.rawCached,
        weightKg,
        billableWeightKg: billable?.billableKg ?? null,
        itemSpecifics: Boolean(itemSpecifics),
        locationDiagram: locationDiagram?.mode ?? null,
        infographic: Boolean(infographic),
        costUsd: (locationDiagram?.costUsd ?? 0) + (infographic?.costUsd ?? 0),
      };
    } catch (err: any) {
      await this.setStatus(partId, 'FAILED');
      this.logger.error(
        `Enrichment failed for ${partId}: ${err?.message || err}`,
      );
      throw err;
    }
  }

  private resolveRealTrackListingId(
    offers: Array<{ externalOfferId: string | null; sourceKey: string | null }>,
  ): string | null {
    for (const offer of offers) {
      if (offer.externalOfferId && UUID_RE.test(offer.externalOfferId)) {
        return offer.externalOfferId;
      }
      // sourceKey format: rt:<storeId>:<listingId>
      const key = offer.sourceKey || '';
      const m = key.match(/^rt:[0-9a-f-]+:([0-9a-f-]{36})$/i);
      if (m) return m[1];
    }
    return null;
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
