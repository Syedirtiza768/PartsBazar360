/**
 * Runs the search outbox drain on an interval inside the worker process.
 *
 * Deliberately a plain interval rather than a new scheduling dependency: the
 * repo already carries BullMQ for ingestion, and adding `@nestjs/schedule` for
 * one loop is not worth the surface. The loop is lifecycle-managed so the
 * worker shuts down cleanly.
 *
 * Only runs where `RUN_SEARCH_OUTBOX_WORKER` is enabled — same convention as
 * `RUN_INGESTION_WORKER`, so the API process does not compete with the worker
 * for the same rows. Defaults to on in the worker, off in the API.
 */

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SearchOutboxService } from './search-outbox.service';

const TICK_MS = Number(process.env.SEARCH_OUTBOX_TICK_MS || 5_000);
const RECOVER_EVERY_TICKS = Number(process.env.SEARCH_OUTBOX_RECOVER_TICKS || 60);

@Injectable()
export class SearchOutboxRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchOutboxRunner.name);
  private timer?: NodeJS.Timeout;
  private ticks = 0;

  constructor(private readonly outbox: SearchOutboxService) {}

  private get enabled(): boolean {
    const explicit = process.env.RUN_SEARCH_OUTBOX_WORKER;
    if (explicit != null) return explicit !== '0';
    // Default: on in the worker process, off everywhere else.
    return process.env.RUN_INGESTION_WORKER === '1';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Search outbox runner disabled in this process');
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Do not hold the event loop open on shutdown.
    this.timer.unref?.();
    this.logger.log(`Search outbox runner started (every ${TICK_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      // Periodically return rows stranded by a crashed worker to PENDING.
      if (this.ticks++ % RECOVER_EVERY_TICKS === 0) {
        await this.outbox.recoverStuck();
      }

      const result = await this.outbox.drain();
      if (result.claimed > 0) {
        this.logger.log(
          `outbox drained: claimed=${result.claimed} indexed=${result.indexed} ` +
            `deleted=${result.deleted} retried=${result.retried} ` +
            `deadLettered=${result.deadLettered}`,
        );
      }
    } catch (error: any) {
      // Never let a tick failure kill the interval.
      this.logger.error(`outbox tick failed: ${error?.message}`, error?.stack);
    }
  }
}
