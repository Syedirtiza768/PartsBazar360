/**
 * Transactional-outbox consumer for search indexing (brief §19).
 *
 * The existing outbox is not a real outbox. `uploads.service.ts` writes a
 * PENDING row, indexes inline, then marks it DONE — and `indexPart` swallows
 * every error internally, so a write that never reached OpenSearch still marks
 * the row DONE. That is why production has 198,129 DONE rows and 14,680
 * buyer-visible parts missing from the index, plus 4,246 PENDING rows with no
 * consumer at all. See docs/SEARCH_PHASE1_AUDIT.md §4 RC-7.
 *
 * This makes it real:
 *  - a row is only marked DONE after the index write actually succeeded;
 *  - failures are retried with exponential backoff via `availableAt`;
 *  - a row that exhausts its attempts becomes FAILED (dead letter) and is
 *    reported rather than silently dropped;
 *  - rows are claimed so multiple workers cannot process the same entity.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { SearchIndexerService } from './search-indexer.service';

export const MAX_ATTEMPTS = Number(process.env.SEARCH_OUTBOX_MAX_ATTEMPTS || 5);
export const BATCH_SIZE = Number(process.env.SEARCH_OUTBOX_BATCH || 200);

/** Exponential backoff with a ceiling: 1m, 2m, 4m, 8m, 16m. */
export function backoffMs(attempts: number): number {
  const base = Number(process.env.SEARCH_OUTBOX_BACKOFF_MS || 60_000);
  return Math.min(base * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
}

export interface DrainResult {
  claimed: number;
  indexed: number;
  deleted: number;
  retried: number;
  deadLettered: number;
}

@Injectable()
export class SearchOutboxService {
  private readonly logger = new Logger(SearchOutboxService.name);
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: SearchIndexerService,
  ) {}

  /**
   * Record that a part needs (re)indexing. Cheap and safe to call from any
   * write path — including the ones that currently do not reindex at all:
   * price change, inventory change, fitment change, seller suspension.
   */
  async enqueue(
    entityId: string,
    operation: 'UPSERT' | 'DELETE' = 'UPSERT',
    reason?: string,
  ): Promise<void> {
    await this.prisma.searchOutbox.create({
      data: {
        entityType: 'CanonicalPart',
        entityId,
        operation,
        payload: reason ? { reason } : undefined,
        status: 'PENDING',
      },
    });
  }

  /** Bulk enqueue, used by the reconcile job. */
  async enqueueMany(
    entityIds: string[],
    operation: 'UPSERT' | 'DELETE' = 'UPSERT',
    reason?: string,
  ): Promise<number> {
    if (!entityIds.length) return 0;
    const result = await this.prisma.searchOutbox.createMany({
      data: entityIds.map((entityId) => ({
        entityType: 'CanonicalPart',
        entityId,
        operation,
        payload: reason ? { reason } : undefined,
        status: 'PENDING',
      })),
    });
    return result.count;
  }

  /**
   * Process one batch of due rows.
   *
   * Guarded by an in-process flag so a slow drain cannot overlap itself when
   * the scheduler fires again.
   */
  async drain(): Promise<DrainResult> {
    const result: DrainResult = {
      claimed: 0,
      indexed: 0,
      deleted: 0,
      retried: 0,
      deadLettered: 0,
    };
    if (this.draining) return result;
    this.draining = true;

    try {
      const due = await this.prisma.searchOutbox.findMany({
        where: { status: 'PENDING', availableAt: { lte: new Date() } },
        orderBy: { availableAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, entityId: true, operation: true, attempts: true },
      });
      if (!due.length) return result;

      // Claim them so a second worker skips this batch.
      const claim = await this.prisma.searchOutbox.updateMany({
        where: { id: { in: due.map((row) => row.id) }, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
      result.claimed = claim.count;

      // Collapse duplicates: many rows can target the same part (a bulk import
      // writes one per offer). Indexing once per part is both correct and far
      // cheaper — the document is rebuilt from current state either way.
      const latestByEntity = new Map<string, typeof due>();
      for (const row of due) {
        const existing = latestByEntity.get(row.entityId) ?? [];
        existing.push(row);
        latestByEntity.set(row.entityId, existing);
      }

      for (const [entityId, rows] of latestByEntity) {
        const isDelete = rows.some((row) => row.operation === 'DELETE');
        const ids = rows.map((row) => row.id);
        try {
          if (isDelete) {
            await this.indexer.removePart(entityId);
            result.deleted++;
          } else {
            const outcome = await this.indexer.indexPart(entityId);
            if (outcome === 'INDEXED') result.indexed++;
            else result.deleted++;
          }
          await this.prisma.searchOutbox.updateMany({
            where: { id: { in: ids } },
            data: { status: 'DONE', processedAt: new Date(), lastError: null },
          });
        } catch (error: any) {
          const attempts = Math.max(...rows.map((row) => row.attempts)) + 1;
          const message = String(error?.message ?? error).slice(0, 500);

          if (attempts >= MAX_ATTEMPTS) {
            result.deadLettered++;
            await this.prisma.searchOutbox.updateMany({
              where: { id: { in: ids } },
              data: { status: 'FAILED', attempts, lastError: message },
            });
            this.logger.error(
              `Dead-lettered ${entityId} after ${attempts} attempts: ${message}`,
            );
          } else {
            result.retried++;
            await this.prisma.searchOutbox.updateMany({
              where: { id: { in: ids } },
              data: {
                status: 'PENDING',
                attempts,
                lastError: message,
                availableAt: new Date(Date.now() + backoffMs(attempts)),
              },
            });
          }
        }
      }

      return result;
    } finally {
      this.draining = false;
    }
  }

  /**
   * Rows left PROCESSING by a worker that crashed mid-batch. Returned to
   * PENDING so they are not stranded forever.
   */
  async recoverStuck(olderThanMs = 10 * 60_000): Promise<number> {
    const result = await this.prisma.searchOutbox.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - olderThanMs) } },
      data: { status: 'PENDING' },
    });
    if (result.count) {
      this.logger.warn(`Recovered ${result.count} stuck PROCESSING rows`);
    }
    return result.count;
  }

  /** Queue health, for observability (brief §27). */
  async stats(): Promise<{
    counts: Record<string, number>;
    /** Indexing lag: age of the oldest row still waiting. */
    oldestPendingAgeMs: number | null;
  }> {
    const grouped = await this.prisma.searchOutbox.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.status] = row._count._all;

    const oldest = await this.prisma.searchOutbox.findFirst({
      where: { status: 'PENDING' },
      orderBy: { availableAt: 'asc' },
      select: { createdAt: true },
    });

    return {
      counts,
      oldestPendingAgeMs: oldest ? Date.now() - oldest.createdAt.getTime() : null,
    };
  }

  /** Re-arm dead letters, e.g. after fixing the cause of the failure. */
  async retryFailed(limit = 1000): Promise<number> {
    const failed = await this.prisma.searchOutbox.findMany({
      where: { status: 'FAILED' },
      take: limit,
      select: { id: true },
    });
    if (!failed.length) return 0;
    const result = await this.prisma.searchOutbox.updateMany({
      where: { id: { in: failed.map((row) => row.id) } },
      data: { status: 'PENDING', attempts: 0, availableAt: new Date() },
    });
    return result.count;
  }
}
