/**
 * Checkpoint — crash-safe, resumable job state.
 *
 * "Always completes the job" is mostly a state-management property, not a
 * stealth property. Every item transitions through exactly one state
 * machine: queued → done, or queued → (failed × maxAttempts) → deadLetter.
 * State is persisted atomically (tmp file + rename) and throttled, so a
 * SIGINT, crash, or machine reboot loses at most a few seconds of work.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const VERSION = 1;

export class Checkpoint {
  constructor(filePath, { maxAttempts = 4, saveIntervalMs = 2_000 } = {}) {
    this.filePath = filePath;
    this.maxAttempts = maxAttempts;
    this.saveIntervalMs = saveIntervalMs;
    this._lastSave = 0;
    this._dirty = false;

    this.data = {
      version: VERSION,
      queue: [],            // [{key, url, meta?}]
      done: [],             // keys
      attempts: {},         // key → n
      deadLetter: [],       // [{item, attempts, lastReason, at}]
      stats: { fetched: 0, blocked: 0, itemsFound: 0, startedAt: new Date().toISOString() },
      rateLimit: null,
      ladder: null,
    };
    this._done = new Set();
    this._queued = new Set();
  }

  static load(filePath, opts) {
    const cp = new Checkpoint(filePath, opts);
    if (existsSync(filePath)) {
      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (raw && raw.version === VERSION) {
          cp.data = { ...cp.data, ...raw };
        }
      } catch { /* corrupt state → start fresh rather than crash */ }
    }
    cp._done = new Set(cp.data.done);
    cp._queued = new Set(cp.data.queue.map((i) => i.key));
    return cp;
  }

  get size() { return this.data.queue.length; }
  get doneCount() { return this._done.size; }
  get deadLetters() { return this.data.deadLetter; }

  isDone(key) { return this._done.has(key); }

  /** Enqueue items not already done or queued. Returns number added. */
  enqueue(items) {
    let added = 0;
    for (const item of items) {
      if (this._done.has(item.key) || this._queued.has(item.key)) continue;
      this.data.queue.push(item);
      this._queued.add(item.key);
      added++;
    }
    this._dirty = true;
    return added;
  }

  /** Take the next queued item (undefined when drained). */
  next() {
    const item = this.data.queue.shift();
    if (item) this._queued.delete(item.key);
    if (item) this._dirty = true;
    return item;
  }

  /** Requeue at the back (used for soft failures). */
  requeue(item) {
    if (this._done.has(item.key)) return;
    this.data.queue.push(item);
    this._queued.add(item.key);
    this._dirty = true;
  }

  markDone(key) {
    this._done.add(key);
    delete this.data.attempts[key];
    this.data.stats.fetched++;
    this._dirty = true;
    this._saveThrottled();
  }

  /**
   * Record a failure. Requeues below maxAttempts, otherwise dead-letters.
   * @returns {'requeued'|'dead'}
   */
  markFailure(item, reason) {
    this.data.stats.blocked++;
    const n = (this.data.attempts[item.key] || 0) + 1;
    this.data.attempts[item.key] = n;
    let outcome;
    if (n < this.maxAttempts) {
      this.requeue(item);
      outcome = 'requeued';
    } else {
      if (!this.data.deadLetter.some((d) => d.item.key === item.key)) {
        this.data.deadLetter.push({ item, attempts: n, lastReason: reason, at: new Date().toISOString() });
      }
      outcome = 'dead';
    }
    this._dirty = true;
    this._saveThrottled();
    return outcome;
  }

  /** Remove a dead-letter entry (after a successful sweep retry). */
  clearDeadLetter(key) {
    const before = this.data.deadLetter.length;
    this.data.deadLetter = this.data.deadLetter.filter((d) => d.item.key !== key);
    if (this.data.deadLetter.length !== before) this._dirty = true;
  }

  addItemsFound(n) {
    this.data.stats.itemsFound += n;
    this._dirty = true;
  }

  _saveThrottled() {
    if (Date.now() - this._lastSave >= this.saveIntervalMs) this.save();
  }

  /** Atomic persist: write tmp, then rename over the target. */
  save() {
    this._lastSave = Date.now();
    if (!this._dirty && existsSync(this.filePath)) return;
    const out = { ...this.data, done: [...this._done], updatedAt: new Date().toISOString() };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(out));
      renameSync(tmp, this.filePath);
      this._dirty = false;
    } catch { /* a missed save is recoverable; a crash is not — never throw here */ }
  }
}
