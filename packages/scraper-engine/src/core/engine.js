/**
 * ScrapeEngine — orchestrates queue, strategies, pacing, and checkpointing.
 *
 * Guarantees:
 *  - Completion: the loop drains the queue, then sweeps the dead-letter list
 *    once at the highest tier. An item only leaves the system via done,
 *    confirmed-empty (top tier), or an explicit dead-letter after the sweep.
 *  - Non-detection: every request flows through the AdaptiveRateLimiter
 *    (AIMD + jitter), block signals feed the StrategyLadder (escalation) and
 *    SessionManager (session burn + rotation), and human-cadence delays are
 *    layered on top.
 *  - Resumability: SIGINT/SIGTERM/crash → checkpoint persists; re-running
 *    the same command continues where it stopped.
 */
import { AdaptiveRateLimiter } from './ratelimit.js';
import { assessPage } from './blockdetect.js';
import { StrategyLadder } from './strategy-ladder.js';
import { SessionManager } from './session.js';
import { fetchStrategy } from './strategies/fetch.js';
import { headlessStrategy, headedStrategy, cdpStrategy } from './strategies/browser.js';
import { samplePersona } from './fingerprint.js';
import { pageInterval, readingPause, shouldRead, sleep } from './humanize.js';

const STRATEGY_MAP = {
  fetch: fetchStrategy,
  headless: headlessStrategy,
  headed: headedStrategy,
  cdp: cdpStrategy,
};

export class ScrapeEngine {
  constructor({
    adapter,
    checkpoint,
    tiers = ['fetch', 'headless', 'headed', 'cdp'],
    startTier = 'headless',
    rateLimiterOptions = {},
    sessionOptions = {},
    maxRuntimeMs = 6 * 3_600_000,
    maxRequests = Infinity,
    logger = console,
    rng = Math.random,
    onItems = async () => {},
    onProgress = () => {},
  }) {
    this.adapter = adapter;
    this.checkpoint = checkpoint;
    this.ladder = new StrategyLadder({ tiers, startTier });
    this.rateLimiter = new AdaptiveRateLimiter({ rng, ...rateLimiterOptions });
    this.sessions = new SessionManager({ logger, rng, ...sessionOptions });
    this.maxRuntimeMs = maxRuntimeMs;
    this.maxRequests = maxRequests;
    this.logger = logger;
    this.rng = rng;
    this.onItems = onItems;
    this.onProgress = onProgress;

    this.requests = 0;
    this.pagesSincePause = 0;
    this.interrupted = false;
    this._fetchPersona = samplePersona(rng);
    this._fetchPersonaUses = 0;
  }

  _strategy() {
    return STRATEGY_MAP[this.ladder.current()];
  }

  _personaForFetchTier() {
    if (this._fetchPersonaUses++ >= 30) {
      this._fetchPersona = samplePersona(this.rng);
      this._fetchPersonaUses = 0;
    }
    return this._fetchPersona;
  }

  async run() {
    const startedAt = Date.now();
    this.ladder.restore(this.checkpoint.data.ladder || {});
    this.rateLimiter.restore(this.checkpoint.data.rateLimit || {});

    const onSignal = async () => {
      if (this.interrupted) return;
      this.interrupted = true;
      this.logger.log('\n[engine] interrupt received — saving checkpoint (safe to re-run to resume)');
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    let status = 'complete';
    try {
      status = await this._mainLoop(startedAt);
      if (status === 'complete') {
        await this._deadLetterSweep();
      }
    } finally {
      this.checkpoint.data.ladder = this.ladder.snapshot();
      this.checkpoint.data.rateLimit = this.rateLimiter.snapshot();
      this.checkpoint.save();
      await this.sessions.close();
    }

    return this._report(status, startedAt);
  }

  async _mainLoop(startedAt) {
    const { adapter, checkpoint } = this;

    while (!this.interrupted) {
      if (Date.now() - startedAt > this.maxRuntimeMs) return 'budget-exhausted';
      if (this.requests >= this.maxRequests) return 'budget-exhausted';

      const item = checkpoint.next();
      if (!item) return 'complete';
      if (checkpoint.isDone(item.key)) continue;

      const strategy = this._strategy();
      await this.rateLimiter.acquire();
      if (strategy.needsBrowser) {
        await this.sessions.getPage(strategy.name); // ensure session before warmup
        await this.sessions.warmup(adapter.warmupUrl);
      }

      this.requests++;
      const result = await strategy.fetchPage(item, {
        persona: this._personaForFetchTier(),
        sessionManager: this.sessions,
        rng: this.rng,
      });
      if (result.retryAfterMs) this.rateLimiter.onRetryAfter(result.retryAfterMs);

      // --- extract ---
      let ids = [];
      let extractErr = null;
      try {
        if (result.error) {
          ids = [];
        } else if (strategy.needsBrowser && adapter.extractFromPage && this.sessions._session?.page) {
          ids = await adapter.extractFromPage(this.sessions._session.page, item);
          if (!ids?.length && result.html) ids = adapter.extractFromHtml(result.html, item);
        } else {
          ids = adapter.extractFromHtml(result.html, item);
        }
      } catch (e) {
        extractErr = e;
        ids = [];
      }

      // --- assess ---
      const assessment = assessPage({
        status: result.status,
        finalUrl: result.finalUrl,
        title: result.title,
        bodyText: result.bodyText,
        htmlLength: result.htmlLength,
        extractedCount: ids.length,
        expectedMin: adapter.expectedMin?.(item) ?? 0,
        allowEmpty: adapter.allowEmpty?.(item) ?? false,
      });
      if (extractErr && !assessment.blocked) {
        assessment.blocked = true;
        assessment.severity = 'soft';
        assessment.reasons.push(`extract:${extractErr.message}`);
      }

      if (assessment.blocked) {
        const reason = assessment.reasons.join(',') || 'unknown';
        const disposition = checkpoint.markFailure(item, reason);
        this.rateLimiter.onBlock(assessment.severity);
        const move = this.ladder.recordOutcome(assessment.severity);
        if (move.action === 'escalate') {
          this.sessions.invalidate(); // burn the flagged session
          this.logger.warn(`[engine] ${assessment.severity} block on ${item.key} (${reason}) → escalate ${move.from} → ${move.to}`);
        } else if (move.action === 'cooldown') {
          this.sessions.invalidate();
          const wait = this.rateLimiter.onBlock('hard');
          this.logger.warn(`[engine] top-tier block on ${item.key} (${reason}) → cooldown ${(wait / 1000).toFixed(0)}s`);
        } else {
          this.logger.debug?.(`[engine] ${assessment.severity} block on ${item.key} (${reason}) → ${disposition}`);
        }
        this.onProgress({ item, outcome: assessment.severity, found: 0, tier: this.ladder.current() });
        continue;
      }

      // --- success ---
      checkpoint.markDone(item.key);
      checkpoint.addItemsFound(ids.length);
      this.rateLimiter.onSuccess();
      const move = this.ladder.recordOutcome('success');
      if (move.action === 'deescalate') {
        this.logger.log(`[engine] sustained success → de-escalate ${move.from} → ${move.to}`);
      }
      await this.onItems(ids, item);
      this.onProgress({ item, outcome: 'ok', found: ids.length, tier: this.ladder.current(), thin: assessment.thin });

      // --- human cadence ---
      this.pagesSincePause++;
      if (shouldRead(this.pagesSincePause, this.rng)) {
        this.pagesSincePause = 0;
        await sleep(readingPause(this.rng));
      } else {
        await sleep(pageInterval(this.rng));
      }
    }
    return 'interrupted';
  }

  /**
   * Final sweep: retry every dead-letter once at the top tier. A zero-yield
   * page with no other block markers at the top tier is confirmed-empty —
   * that is how legitimate end-of-results is distinguished from blocking.
   */
  async _deadLetterSweep() {
    const { adapter, checkpoint } = this;
    const dead = [...checkpoint.deadLetters];
    if (!dead.length) return;

    const topTier = this.ladder.tiers[this.ladder.tiers.length - 1];
    this.logger.log(`[engine] dead-letter sweep: ${dead.length} item(s) at tier=${topTier}`);

    for (const entry of dead) {
      if (this.interrupted) break;
      const { item } = entry;
      await this.rateLimiter.acquire();
      const strategy = STRATEGY_MAP[topTier];
      const result = await strategy.fetchPage(item, {
        persona: this._fetchPersona,
        sessionManager: this.sessions,
        rng: this.rng,
      });

      let ids = [];
      try {
        if (!result.error) {
          ids = strategy.needsBrowser && adapter.extractFromPage && this.sessions._session?.page
            ? await adapter.extractFromPage(this.sessions._session.page, item)
            : adapter.extractFromHtml(result.html, item);
          if (!ids.length && result.html) ids = adapter.extractFromHtml(result.html, item);
        }
      } catch { ids = []; }

      const assessment = assessPage({
        status: result.status,
        finalUrl: result.finalUrl,
        title: result.title,
        bodyText: result.bodyText,
        htmlLength: result.htmlLength,
        extractedCount: ids.length,
        expectedMin: adapter.expectedMin?.(item) ?? 0,
        allowEmpty: true, // sweep: empty is a legitimate terminal state
      });

      if (!assessment.blocked || assessment.reasons.every((r) => r === 'zero-yield' || r.startsWith('tiny-html'))) {
        checkpoint.markDone(item.key);
        checkpoint.clearDeadLetter(item.key);
        if (ids.length) {
          checkpoint.addItemsFound(ids.length);
          await this.onItems(ids, item);
        }
        this.logger.log(`[engine] sweep resolved ${item.key}: ${ids.length ? `${ids.length} items` : 'confirmed empty'}`);
      } else {
        this.logger.warn(`[engine] sweep still blocked on ${item.key} (${assessment.reasons.join(',')}) — left in dead-letter for the next run`);
      }
      await sleep(pageInterval(this.rng));
    }
  }

  _report(status, startedAt) {
    const s = this.checkpoint.data.stats;
    return {
      status,
      requests: this.requests,
      pagesDone: this.checkpoint.doneCount,
      queueRemaining: this.checkpoint.size,
      deadLetters: this.checkpoint.deadLetters.length,
      itemsFound: s.itemsFound,
      blocked: s.blocked,
      tierStats: this.ladder.perTier,
      finalTier: this.ladder.current(),
      runtimeMs: Date.now() - startedAt,
    };
  }
}
