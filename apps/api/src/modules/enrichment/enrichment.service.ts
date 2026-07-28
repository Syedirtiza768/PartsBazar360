import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { isExactWeightSource } from '../checkout/billable-weight.util';

/** Current prompt/pipeline generation. Bump to re-enrich the whole catalog. */
export const ENRICHMENT_VERSION = 2;

/** BullMQ: lower number = higher priority. PDP must always beat prewarm. */
export const ENRICHMENT_PDP_PRIORITY = 1;
export const ENRICHMENT_PREWARM_PRIORITY = 50;

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
 * Speculative pre-warm (search / hover) is OFF by default: flooding the queue
 * burns budget and parks real PDP views behind dozens of parts nobody opened.
 * When a buyer opens a listing we either enqueue at top priority or promote an
 * existing prewarm job so the page they are looking at finishes first.
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

  /** Speculative search/hover warm-up. Default off — enable with ENRICHMENT_PREWARM=1. */
  private get prewarmEnabled(): boolean {
    return process.env.ENRICHMENT_PREWARM === '1';
  }

  private get prewarmMaxBacklog(): number {
    const raw = Number(process.env.ENRICHMENT_PREWARM_MAX_BACKLOG || 4);
    return Number.isFinite(raw) && raw >= 0 ? raw : 4;
  }

  private jobIdFor(partId: string): string {
    return `enrich:${partId}:v${ENRICHMENT_VERSION}`;
  }

  private isPdpReason(reason?: string): boolean {
    return !reason || reason === 'pdp_view';
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

  /** Waiting + prioritized jobs that have not started yet. */
  private async waitingBacklog(): Promise<number> {
    const [waiting, prioritized] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getPrioritizedCount(),
    ]);
    return waiting + prioritized;
  }

  /**
   * If a prewarm job is already sitting in the queue, bump it to PDP priority
   * so the listing the buyer opened runs next.
   */
  private async promoteQueuedJob(
    partId: string,
    priority: number,
    reason: string,
  ): Promise<boolean> {
    const job = await this.queue.getJob(this.jobIdFor(partId));
    if (!job) return false;

    const state = await job.getState();
    if (state === 'active' || state === 'completed' || state === 'failed') {
      return false;
    }

    const currentPriority = job.opts.priority ?? ENRICHMENT_PREWARM_PRIORITY;
    if (priority < currentPriority) {
      await job.changePriority({ priority });
      await job.updateData({
        ...(job.data as object),
        partId,
        reason,
        promotedAt: new Date().toISOString(),
      });
      this.logger.log(
        `Promoted enrichment ${partId} priority ${currentPriority} → ${priority} (${reason})`,
      );
    }
    return true;
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

    const reason = opts.reason || 'pdp_view';
    const isPdp = this.isPdpReason(reason);
    const priority = opts.priority ?? (isPdp ? ENRICHMENT_PDP_PRIORITY : ENRICHMENT_PREWARM_PRIORITY);

    // Mid-flight: leave it alone — promotion cannot interrupt an OpenRouter call.
    if (part.enrichmentStatus === 'RUNNING') return;

    // Already queued: PDP views promote; speculative callers no-op.
    if (part.enrichmentStatus === 'QUEUED') {
      if (isPdp) {
        try {
          const promoted = await this.promoteQueuedJob(part.id, priority, reason);
          if (!promoted) {
            // Orphaned QUEUED row with no Redis job — re-enqueue.
            await this.enqueue(part.id, priority, reason);
          }
        } catch (err: any) {
          this.logger.warn(
            `Failed to promote enrichment for ${part.id}: ${err?.message || err}`,
          );
        }
      }
      return;
    }

    try {
      await this.enqueue(part.id, priority, reason);
    } catch (err: any) {
      // Never let enrichment bookkeeping break a product page.
      this.logger.warn(
        `Failed to queue enrichment for ${part.id}: ${err?.message || err}`,
      );
    }
  }

  private async enqueue(
    partId: string,
    priority: number,
    reason: string,
  ): Promise<void> {
    await this.queue.add(
      'enrich-part',
      { partId, reason },
      {
        jobId: this.jobIdFor(partId),
        priority,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 200,
      },
    );

    await this.prisma.canonicalPart.update({
      where: { id: partId },
      data: { enrichmentStatus: 'QUEUED' },
    });
  }

  /**
   * Bulk pre-warm used by search results and hover intent.
   * Disabled unless ENRICHMENT_PREWARM=1, and refused when the queue is already
   * busy so speculative work cannot bury live PDP jobs.
   */
  async requestEnrichmentForMany(
    parts: EnrichmentCandidate[],
    opts: { priority?: number; reason?: string; limit?: number } = {},
  ): Promise<void> {
    if (!this.enabled) return;
    if (!this.prewarmEnabled) return;

    try {
      const backlog = await this.waitingBacklog();
      if (backlog >= this.prewarmMaxBacklog) {
        this.logger.debug(
          `Skipping prewarm: backlog ${backlog} ≥ ${this.prewarmMaxBacklog}`,
        );
        return;
      }
    } catch (err: any) {
      this.logger.warn(`Prewarm backlog check failed: ${err?.message || err}`);
      return;
    }

    const limit = opts.limit ?? 3;
    const targets = parts.filter((p) => this.needsEnrichment(p)).slice(0, limit);
    for (const part of targets) {
      await this.requestEnrichment(part, {
        priority: opts.priority ?? ENRICHMENT_PREWARM_PRIORITY,
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
    if (!this.prewarmEnabled) return 0;
    const unique = [...new Set(partIds.filter(Boolean))];
    if (!unique.length) return 0;

    const limit = opts.limit ?? 3;
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
