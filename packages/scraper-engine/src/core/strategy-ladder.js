/**
 * StrategyLadder — automatic escalation across fetch tiers.
 *
 * The engine starts cheap (plain fetch) and climbs only when the target
 * proves hostile:
 *
 *   fetch ──block──▶ headless ──block──▶ headed ──block──▶ cdp (real Chrome)
 *
 * Rules:
 *  - A hard block escalates after `hardEscalateAfter` consecutive hard blocks.
 *  - Soft blocks accumulate 1/3 weight (they are often transient WAF jitter).
 *  - At the top tier a block means *cool down and retry*, never abort — the
 *    job contract is completion, and cooldowns are bounded by maxRuntimeMs.
 *  - After `deescalateAfter` consecutive successes at a costly tier, probe one
 *    step down (cost control). Never de-escalate into a tier that hard-blocked
 *    this run.
 */
export class StrategyLadder {
  constructor({
    tiers = ['fetch', 'headless', 'headed', 'cdp'],
    startTier = 'headless',
    hardEscalateAfter = 2,
    deescalateAfter = 30,
  } = {}) {
    this.tiers = tiers;
    this.index = Math.max(0, tiers.indexOf(startTier));
    this.hardEscalateAfter = hardEscalateAfter;
    this.deescalateAfter = deescalateAfter;
    this.hardStreak = 0;
    this.softScore = 0;
    this.successStreak = 0;
    this.blockedTiers = new Set();   // tiers that hard-blocked this run
    this.perTier = {};               // tier → {ok, soft, hard}
  }

  current() {
    return this.tiers[this.index];
  }

  isTop() {
    return this.index >= this.tiers.length - 1;
  }

  _bump(tier, field) {
    this.perTier[tier] ||= { ok: 0, soft: 0, hard: 0 };
    this.perTier[tier][field]++;
  }

  /**
   * @param {'success'|'soft'|'hard'} outcome
   * @returns {{action:'none'|'escalate'|'deescalate'|'cooldown', from:string, to:string}}
   */
  recordOutcome(outcome) {
    const tier = this.current();

    if (outcome === 'success') {
      this._bump(tier, 'ok');
      this.hardStreak = 0;
      this.softScore = 0;
      this.successStreak++;
      this.blockedTiers.delete(tier);
      if (this.successStreak >= this.deescalateAfter && this.index > 0) {
        const target = this._deescalationTarget();
        if (target < this.index) {
          const from = tier;
          this.index = target;
          this.successStreak = 0;
          return { action: 'deescalate', from, to: this.current() };
        }
      }
      return { action: 'none', from: tier, to: tier };
    }

    this.successStreak = 0;
    if (outcome === 'hard') {
      this._bump(tier, 'hard');
      this.hardStreak++;
      this.blockedTiers.add(tier);
    } else {
      this._bump(tier, 'soft');
      this.softScore += 1 / 3;
    }

    if (this.hardStreak >= this.hardEscalateAfter || this.softScore >= 1) {
      this.hardStreak = 0;
      this.softScore = 0;
      if (this.isTop()) {
        return { action: 'cooldown', from: tier, to: tier };
      }
      const from = tier;
      this.index++;
      return { action: 'escalate', from, to: this.current() };
    }
    return { action: 'none', from: tier, to: tier };
  }

  _deescalationTarget() {
    for (let i = this.index - 1; i >= 0; i--) {
      if (!this.blockedTiers.has(this.tiers[i])) return i;
    }
    return this.index;
  }

  snapshot() {
    return {
      index: this.index,
      successStreak: this.successStreak,
      blockedTiers: [...this.blockedTiers],
      perTier: this.perTier,
    };
  }

  restore(s = {}) {
    if (Number.isInteger(s.index) && s.index >= 0 && s.index < this.tiers.length) this.index = s.index;
    if (Number.isFinite(s.successStreak)) this.successStreak = s.successStreak;
    if (Array.isArray(s.blockedTiers)) this.blockedTiers = new Set(s.blockedTiers.filter((t) => this.tiers.includes(t)));
    if (s.perTier && typeof s.perTier === 'object') this.perTier = s.perTier;
  }
}
