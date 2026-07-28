import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Daily spend cap and circuit breaker for AI enrichment.
 *
 * Enrichment is triggered by buyer traffic, so without a ceiling a crawler or a
 * traffic spike turns directly into an unbounded OpenRouter bill. Counters live
 * in Redis so every API and worker replica shares one budget.
 *
 * Degradation is always graceful: when the budget is exhausted or the breaker is
 * open, parts keep their deterministic part-class estimates and simply are not
 * enriched until the window resets.
 */
@Injectable()
export class EnrichmentBudgetService implements OnModuleDestroy {
  private readonly logger = new Logger(EnrichmentBudgetService.name);
  private readonly redis: Redis;

  /** Consecutive upstream failures before the breaker opens. */
  private readonly failureThreshold = 5;
  /** How long the breaker stays open once tripped. */
  private readonly breakerCooldownSeconds = 300;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: null,
    });
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  private dailyBudgetUsd(): number {
    const raw = Number.parseFloat(
      process.env.ENRICHMENT_DAILY_BUDGET_USD || '',
    );
    return Number.isFinite(raw) && raw >= 0 ? raw : 5;
  }

  private spendKey(): string {
    // UTC day boundary so every replica rolls over together.
    const day = new Date().toISOString().slice(0, 10);
    return `enrich:spend:${day}`;
  }

  private readonly breakerKey = 'enrich:breaker:open';
  private readonly failureKey = 'enrich:breaker:failures';

  /**
   * Whether a new enrichment job may run. Checked in the worker rather than at
   * enqueue time so a job queued before the cap was hit still respects it.
   */
  async canSpend(): Promise<{ allowed: boolean; reason?: string }> {
    const budget = this.dailyBudgetUsd();
    if (budget <= 0) {
      return { allowed: false, reason: 'Enrichment budget is set to zero' };
    }

    try {
      const [open, spentRaw] = await Promise.all([
        this.redis.get(this.breakerKey),
        this.redis.get(this.spendKey()),
      ]);

      if (open) {
        return { allowed: false, reason: 'Circuit breaker is open' };
      }

      const spent = Number.parseFloat(spentRaw || '0') || 0;
      if (spent >= budget) {
        return {
          allowed: false,
          reason: `Daily budget exhausted ($${spent.toFixed(4)} of $${budget})`,
        };
      }

      return { allowed: true };
    } catch (err: any) {
      // Redis being down must not silently remove the spend ceiling.
      this.logger.warn(
        `Budget check failed, refusing enrichment: ${err?.message || err}`,
      );
      return { allowed: false, reason: 'Budget store unavailable' };
    }
  }

  /** Records spend for the current UTC day. */
  async recordSpend(costUsd: number): Promise<void> {
    if (!Number.isFinite(costUsd) || costUsd <= 0) return;
    const key = this.spendKey();
    try {
      await this.redis.incrbyfloat(key, costUsd);
      // Two days of retention is enough for the rollover and for inspection.
      await this.redis.expire(key, 172_800);
    } catch (err: any) {
      this.logger.warn(`Failed to record spend: ${err?.message || err}`);
    }
  }

  async recordSuccess(): Promise<void> {
    try {
      await this.redis.del(this.failureKey);
    } catch {
      // Non-fatal: a stale failure count only makes the breaker more cautious.
    }
  }

  /** Trips the breaker once failures are consistent rather than incidental. */
  async recordFailure(): Promise<void> {
    try {
      const failures = await this.redis.incr(this.failureKey);
      await this.redis.expire(this.failureKey, this.breakerCooldownSeconds);
      if (failures >= this.failureThreshold) {
        await this.redis.set(
          this.breakerKey,
          '1',
          'EX',
          this.breakerCooldownSeconds,
        );
        this.logger.error(
          `Enrichment circuit breaker opened after ${failures} consecutive failures`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`Failed to record failure: ${err?.message || err}`);
    }
  }

  /** Ops/debug snapshot of the current window. */
  async status() {
    const budget = this.dailyBudgetUsd();
    try {
      const [open, spentRaw, failures] = await Promise.all([
        this.redis.get(this.breakerKey),
        this.redis.get(this.spendKey()),
        this.redis.get(this.failureKey),
      ]);
      const spentUsd = Number.parseFloat(spentRaw || '0') || 0;
      return {
        budgetUsd: budget,
        spentUsd: Math.round(spentUsd * 10_000) / 10_000,
        remainingUsd: Math.max(0, Math.round((budget - spentUsd) * 10_000) / 10_000),
        breakerOpen: Boolean(open),
        consecutiveFailures: Number.parseInt(failures || '0', 10) || 0,
      };
    } catch (err: any) {
      return { budgetUsd: budget, error: err?.message || String(err) };
    }
  }
}
