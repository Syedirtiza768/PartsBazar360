/**
 * AdaptiveRateLimiter — AIMD congestion control applied to scraping.
 *
 * Algorithms:
 *  - AIMD (Additive Increase / Multiplicative Decrease): the inter-request
 *    delay shrinks additively while requests succeed and expands
 *    multiplicatively on block signals. Same math TCP uses to avoid
 *    congestion collapse; here it avoids tripping bot counters.
 *  - Decorrelated jitter backoff (AWS-style) for cooldowns:
 *    next = random(base, prev * 3), capped. Avoids the thundering-herd
 *    pattern of plain exponential backoff that WAFs fingerprint easily.
 *  - Circuit breaker: N consecutive block signals parks the host until a
 *    cooldown elapses instead of hammering a WAF that is already alerted.
 *  - Honors Retry-After as a hard floor.
 *
 * State is serializable so a resumed job keeps its learned pace.
 */
export class AdaptiveRateLimiter {
  constructor({
    minDelayMs = 900,
    maxDelayMs = 45_000,
    startDelayMs = 1_800,
    decreaseStepMs = 120,
    successWindow = 6,       // consecutive successes before one additive decrease
    increaseFactor = 2.4,    // multiplicative increase per block signal
    baseCooldownMs = 30_000,
    maxCooldownMs = 12 * 60_000,
    circuitThreshold = 3,    // consecutive blocks that open the circuit
    rng = Math.random,
  } = {}) {
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.delayMs = startDelayMs;
    this.decreaseStepMs = decreaseStepMs;
    this.successWindow = successWindow;
    this.increaseFactor = increaseFactor;
    this.baseCooldownMs = baseCooldownMs;
    this.maxCooldownMs = maxCooldownMs;
    this.circuitThreshold = circuitThreshold;
    this.rng = rng;

    this.consecutiveSuccesses = 0;
    this.consecutiveBlocks = 0;
    this.lastCooldownMs = 0;         // decorrelated-jitter memory
    this.circuitOpenUntil = 0;       // epoch ms
    this.retryAfterFloor = 0;        // epoch ms from Retry-After
  }

  /** Wait for the next permitted request slot. */
  async acquire() {
    const now = Date.now();
    const waitUntil = Math.max(this.circuitOpenUntil, this.retryAfterFloor);
    if (waitUntil > now) {
      await sleep(waitUntil - now);
    }
    // Full jitter on the pacing delay: uniform in [delay/2, delay*1.5].
    const j = 0.5 + this.rng();
    await sleep(Math.round(this.delayMs * j));
  }

  onSuccess() {
    this.consecutiveBlocks = 0;
    this.consecutiveSuccesses++;
    if (this.consecutiveSuccesses % this.successWindow === 0) {
      this.delayMs = Math.max(this.minDelayMs, this.delayMs - this.decreaseStepMs);
    }
  }

  /**
   * @param {'soft'|'hard'} severity soft = anomaly/thin page, hard = CAPTCHA/403/429
   */
  onBlock(severity = 'hard') {
    this.consecutiveSuccesses = 0;
    this.consecutiveBlocks += severity === 'hard' ? 1 : 0.5;
    this.delayMs = Math.min(this.maxDelayMs, Math.round(this.delayMs * this.increaseFactor));

    if (this.consecutiveBlocks >= this.circuitThreshold) {
      this.consecutiveBlocks = 0;
      // Decorrelated jitter: memory of the previous cooldown breaks the
      // periodicity that plain exponential backoff produces.
      this.lastCooldownMs = Math.min(
        this.maxCooldownMs,
        Math.round(this.baseCooldownMs + this.rng() * Math.max(this.lastCooldownMs * 3, this.baseCooldownMs)),
      );
      this.circuitOpenUntil = Date.now() + this.lastCooldownMs;
      return this.lastCooldownMs;
    }
    return 0;
  }

  /** Honor a Retry-After header as a hard floor (seconds or HTTP-date already parsed to ms). */
  onRetryAfter(ms) {
    if (Number.isFinite(ms) && ms > 0) {
      this.retryAfterFloor = Math.max(this.retryAfterFloor, Date.now() + ms);
    }
  }

  cooldownRemainingMs() {
    return Math.max(0, Math.max(this.circuitOpenUntil, this.retryAfterFloor) - Date.now());
  }

  snapshot() {
    return {
      delayMs: this.delayMs,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastCooldownMs: this.lastCooldownMs,
    };
  }

  restore(s = {}) {
    if (Number.isFinite(s.delayMs)) this.delayMs = Math.min(this.maxDelayMs, Math.max(this.minDelayMs, s.delayMs));
    if (Number.isFinite(s.consecutiveSuccesses)) this.consecutiveSuccesses = s.consecutiveSuccesses;
    if (Number.isFinite(s.lastCooldownMs)) this.lastCooldownMs = s.lastCooldownMs;
  }
}

export function parseRetryAfter(headerValue) {
  if (!headerValue) return 0;
  const secs = Number(headerValue);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
