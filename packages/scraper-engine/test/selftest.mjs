/**
 * Offline selftest: exercises every algorithmic component without network.
 * Run: npm run selftest --workspace @repo/scraper-engine
 */
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdaptiveRateLimiter,
  assessPage,
  StrategyLadder,
  Checkpoint,
  samplePersona,
  buildHeaders,
  stealthInitScript,
  ebayStoreAdapter,
  extractIdsFromHtml,
} from '../src/index.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

const seq = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

// ---------------- AdaptiveRateLimiter ----------------
test('limiter: AIMD additive decrease on sustained success', () => {
  const rl = new AdaptiveRateLimiter({ rng: seq([0.5]), startDelayMs: 5000, successWindow: 3, decreaseStepMs: 500 });
  for (let i = 0; i < 9; i++) rl.onSuccess();
  assert.equal(rl.delayMs, 5000 - 3 * 500);
});

test('limiter: multiplicative increase + circuit breaker cooldown', () => {
  const rl = new AdaptiveRateLimiter({ rng: seq([0.5]), startDelayMs: 1000, increaseFactor: 2, circuitThreshold: 2, baseCooldownMs: 10000 });
  rl.onBlock('hard');
  assert.equal(rl.delayMs, 2000);
  const cooldown = rl.onBlock('hard');
  assert.ok(cooldown >= 10000, 'circuit opened with cooldown');
  assert.ok(rl.cooldownRemainingMs() > 0);
});

test('limiter: soft blocks count at half weight', () => {
  const rl = new AdaptiveRateLimiter({ rng: seq([0.5]), circuitThreshold: 2 });
  rl.onBlock('soft');
  rl.onBlock('soft');
  assert.equal(rl.cooldownRemainingMs(), 0, 'two softs = 1.0 < 2, no circuit yet');
});

test('limiter: snapshot/restore keeps learned pace', () => {
  const rl = new AdaptiveRateLimiter({ startDelayMs: 9000, minDelayMs: 100 });
  const snap = rl.snapshot();
  const rl2 = new AdaptiveRateLimiter({ startDelayMs: 100 });
  rl2.restore(snap);
  assert.equal(rl2.delayMs, 9000);
});

// ---------------- assessPage ----------------
test('blockdetect: eBay CAPTCHA page → hard', () => {
  const r = assessPage({ status: 200, title: 'Security Measure', bodyText: 'Pardon our interruption. Please verify you are a human.', htmlLength: 4000, extractedCount: 0, expectedMin: 10 });
  assert.equal(r.severity, 'hard');
  assert.ok(r.blocked);
});

test('blockdetect: HTTP 429 → hard', () => {
  assert.equal(assessPage({ status: 429 }).severity, 'hard');
});

test('blockdetect: redirect to captcha URL → hard', () => {
  assert.equal(assessPage({ status: 200, finalUrl: 'https://www.ebay.com/splashui/captcha?ap=1' }).severity, 'hard');
});

test('blockdetect: zero yield on content page → soft', () => {
  const r = assessPage({ status: 200, htmlLength: 200_000, extractedCount: 0, expectedMin: 10 });
  assert.equal(r.severity, 'soft');
});

test('blockdetect: normal page with items → clean', () => {
  const r = assessPage({ status: 200, htmlLength: 200_000, extractedCount: 60, expectedMin: 10 });
  assert.equal(r.blocked, false);
  assert.equal(r.thin, false);
});

test('blockdetect: low-but-nonzero yield → thin flag, not a block', () => {
  const r = assessPage({ status: 200, htmlLength: 200_000, extractedCount: 2, expectedMin: 10 });
  assert.equal(r.blocked, false);
  assert.equal(r.thin, true);
});

test('blockdetect: Cloudflare "Just a moment" title → hard', () => {
  assert.equal(assessPage({ status: 200, title: 'Just a moment...' }).severity, 'hard');
});

// ---------------- StrategyLadder ----------------
test('ladder: escalates after consecutive hard blocks', () => {
  const l = new StrategyLadder({ startTier: 'fetch', hardEscalateAfter: 2 });
  assert.equal(l.current(), 'fetch');
  assert.equal(l.recordOutcome('hard').action, 'none');
  const move = l.recordOutcome('hard');
  assert.equal(move.action, 'escalate');
  assert.equal(l.current(), 'headless');
});

test('ladder: top-tier block → cooldown, never abort', () => {
  const l = new StrategyLadder({ tiers: ['headless', 'cdp'], startTier: 'cdp', hardEscalateAfter: 1 });
  assert.equal(l.recordOutcome('hard').action, 'cooldown');
  assert.equal(l.current(), 'cdp');
});

test('ladder: de-escalates after sustained success, skips hard-blocked tiers', () => {
  const l = new StrategyLadder({ tiers: ['fetch', 'headless', 'cdp'], startTier: 'fetch', hardEscalateAfter: 1, deescalateAfter: 2 });
  l.recordOutcome('hard'); // fetch burned → headless
  assert.equal(l.current(), 'headless');
  l.recordOutcome('hard'); // headless burned → cdp
  assert.equal(l.current(), 'cdp');
  l.recordOutcome('success');
  const move = l.recordOutcome('success');
  assert.equal(move.action, 'none', 'fetch and headless both hard-blocked → stay at cdp');
});

test('ladder: snapshot/restore roundtrip', () => {
  const l = new StrategyLadder({ tiers: ['fetch', 'headless'], startTier: 'headless' });
  l.recordOutcome('hard');
  const l2 = new StrategyLadder({ tiers: ['fetch', 'headless'] });
  l2.restore(l.snapshot());
  assert.equal(l2.current(), 'headless');
  assert.ok(l2.blockedTiers.has('headless'));
});

// ---------------- Checkpoint ----------------
test('checkpoint: enqueue dedupe, done, failure→dead-letter, persistence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scraper-cp-'));
  const file = join(dir, 'state.json');
  const cp = Checkpoint.load(file, { maxAttempts: 2, saveIntervalMs: 0 });

  const items = [
    { key: 'a', url: 'http://x/a' },
    { key: 'b', url: 'http://x/b' },
    { key: 'a', url: 'http://x/a' }, // duplicate
  ];
  assert.equal(cp.enqueue(items), 2);

  const a = cp.next();
  assert.equal(a.key, 'a');
  cp.markDone(a.key);
  assert.ok(cp.isDone('a'));

  const b = cp.next();
  assert.equal(cp.markFailure(b, 'http-403'), 'requeued');
  const b2 = cp.next();
  assert.equal(b2.key, 'b');
  assert.equal(cp.markFailure(b2, 'http-403'), 'dead');
  assert.equal(cp.deadLetters.length, 1);

  cp.save();
  assert.ok(existsSync(file));

  const reloaded = Checkpoint.load(file, { maxAttempts: 2, saveIntervalMs: 0 });
  assert.ok(reloaded.isDone('a'));
  assert.equal(reloaded.deadLetters.length, 1);
  assert.equal(reloaded.size, 0);
  assert.equal(reloaded.next(), undefined);
});

// ---------------- Fingerprint ----------------
test('fingerprint: persona is internally coherent', () => {
  for (let i = 0; i < 20; i++) {
    const p = samplePersona();
    assert.match(p.userAgent, /Chrome\/\d+\.0\.0\.0/);
    assert.ok(p.secChUa.includes(p.uaMajor), 'sec-ch-ua major matches UA');
    assert.ok(p.viewport.width >= 1366);
    assert.ok(p.languages[0] === 'en-US');
    assert.ok(p.hardwareConcurrency >= 8);
    if (p.name === 'chrome-mac') assert.match(p.userAgent, /Macintosh/);
    else assert.match(p.userAgent, /Windows NT 10\.0/);
  }
});

test('fingerprint: headers + stealth script contain the critical patches', () => {
  const p = samplePersona();
  const h = buildHeaders(p);
  assert.equal(h['User-Agent'], p.userAgent);
  assert.equal(h['sec-ch-ua'], p.secChUa);
  const s = stealthInitScript(p);
  for (const needle of ['webdriver', 'WebGLRenderingContext', 'UNMASKED', 'chrome.runtime', 'permissions', 'hardwareConcurrency', '__playwright']) {
    assert.ok(s.includes(needle), `stealth script patches ${needle}`);
  }
});

// ---------------- eBay adapter ----------------
test('adapter: queue contains store pages then keyword pages, keys unique', () => {
  const a = ebayStoreAdapter({ store: 'salvagea', sellerUsername: 'salvageautopart', maxStorePages: 3, maxKeywordPages: 2, keywords: ['engine', 'brake'] });
  const q = a.buildQueue();
  assert.equal(q.length, 3 + 2 * 2);
  assert.equal(q[0].url, 'https://www.ebay.com/str/salvagea?_ipg=240&_pgn=1');
  assert.ok(q[3].url.includes('/sch/i.html'));
  assert.ok(q[3].url.includes('_nkw=engine'));
  assert.equal(new Set(q.map((i) => i.key)).size, q.length);
});

test('adapter: extraction fuses itm links and JSON ids', () => {
  const html = `
    <a href="https://www.ebay.com/itm/397157007305?x=1">part</a>
    <a href="/itm/397157018144">part2</a>
    <script>{"listingId":"397159257903","itemId":"123456789012"}</script>
    <a href="/itm/397157007305">dup</a>`;
  const ids = extractIdsFromHtml(html).sort();
  assert.deepEqual(ids, ['123456789012', '397157007305', '397157018144', '397159257903']);
});

test('adapter: parses result totals', () => {
  const a = ebayStoreAdapter({ store: 'salvagea' });
  assert.equal(a.parseTotal('<span>26,758 Results</span>'), 26758);
  assert.equal(a.parseTotal('<span>no numbers</span>'), null);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
