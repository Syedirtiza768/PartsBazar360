import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { isExactWeightSource } from '../checkout/billable-weight.util';

/** Current prompt/pipeline generation. Bump to re-enrich the whole catalog. */
export const ENRICHMENT_VERSION = 2;

export interface EnrichmentCandidate {
  id: string;
  weight?: number | null;
  weightSource?: string | null;
  dimensions?: unknown;
  itemSpecifics?: unknown;
  enrichmentStatus?: string | null;
  enrichmentVersion?: number | null;
}

/**
 * Decides what needs enriching and queues it.
 *
 * Enqueueing happens on the PDP read path, so it must never slow a response or
 * throw: every failure is swallowed and the part simply keeps its deterministic
 * class estimate. Deduplication is by part id, so a part being viewed a thousand
 * times concurrently produces exactly one job.
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(
    @InjectQueue('enrichment') private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  private get enabled(): boolean {
    return (
      process.env.ENRICHMENT_ENABLED === '1' && Boolean(process.env.OPENROUTER_API_KEY)
    );
  }

  /**
   * True when a part is missing data the pipeline can supply.
   *
   * Once a part is DONE at the current enrichment version, we stop re-queueing
   * even if the weight came from AI — re-running the same pipeline just burns
   * budget. Missing item specifics are still a reason to run (or re-run).
   */
  needsEnrichment(part: EnrichmentCandidate): boolean {
    if ((part.enrichmentVersion ?? 0) < ENRICHMENT_VERSION) {
      // Old generation: re-check even if it was previously marked done.
      return true;
    }
    if (part.enrichmentStatus === 'FAILED') return false;
    if (part.enrichmentStatus === 'DONE') {
      return !part.itemSpecifics;
    }
    if (!part.itemSpecifics) return true;

    const hasTrustedWeight =
      typeof part.weight === 'number' &&
      part.weight > 0 &&
      isExactWeightSource(part.weightSource);
    return !hasTrustedWeight;
  }

  /**
   * Queues enrichment for a part if it needs it. Fire-and-forget by design —
   * callers must not await this on a request path.
   */
  async requestEnrichment(
    part: EnrichmentCandidate,
    opts: { priority?: number; reason?: string } = {},
  ): Promise<void> {
    if (!this.enabled) return;
    if (!this.needsEnrichment(part)) return;
    // Already queued or running: the dedup key would collide anyway, but this
    // avoids the round trip.
    if (part.enrichmentStatus === 'QUEUED' || part.enrichmentStatus === 'RUNNING') {
      return;
    }

    try {
      await this.queue.add(
        'enrich-part',
        { partId: part.id, reason: opts.reason || 'pdp_view' },
        {
          // One in-flight job per part, however many buyers are looking at it.
          jobId: `enrich:${part.id}:v${ENRICHMENT_VERSION}`,
          priority: opts.priority ?? 5,
          attempts: 2,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 200,
        },
      );

      await this.prisma.canonicalPart.update({
        where: { id: part.id },
        data: { enrichmentStatus: 'QUEUED' },
      });
    } catch (err: any) {
      // Never let enrichment bookkeeping break a product page.
      this.logger.warn(
        `Failed to queue enrichment for ${part.id}: ${err?.message || err}`,
      );
    }
  }

  /** Bulk pre-warm used by search results and hover intent. */
  async requestEnrichmentForMany(
    parts: EnrichmentCandidate[],
    opts: { priority?: number; reason?: string; limit?: number } = {},
  ): Promise<void> {
    if (!this.enabled) return;
    const limit = opts.limit ?? 8;
    const targets = parts.filter((p) => this.needsEnrichment(p)).slice(0, limit);
    for (const part of targets) {
      await this.requestEnrichment(part, {
        // Speculative work must never outrank a part a buyer is actually viewing.
        priority: opts.priority ?? 20,
        reason: opts.reason || 'prewarm',
      });
    }
  }

  /**
   * Pre-warms by part id. Search hit documents rarely carry weightSource /
   * enrichmentStatus, so we load the minimal projection from Postgres rather
   * than trusting the search index.
   */
  async requestEnrichmentByIds(
    partIds: string[],
    opts: { priority?: number; reason?: string; limit?: number } = {},
  ): Promise<number> {
    if (!this.enabled) return 0;
    const unique = [...new Set(partIds.filter(Boolean))];
    if (!unique.length) return 0;

    const limit = opts.limit ?? 8;
    const parts = await this.prisma.canonicalPart.findMany({
      where: { id: { in: unique.slice(0, limit * 2) } },
      select: {
        id: true,
        weight: true,
        weightSource: true,
        dimensions: true,
        itemSpecifics: true,
        enrichmentStatus: true,
        enrichmentVersion: true,
      },
    });

    await this.requestEnrichmentForMany(parts, opts);
    return parts.filter((p) => this.needsEnrichment(p)).slice(0, limit).length;
  }
}
