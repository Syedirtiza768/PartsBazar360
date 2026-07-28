#!/usr/bin/env node
/**
 * eBay store listing scraper — anti-detection, resumable.
 *
 * Usage:
 *   node packages/scraper-engine/cli/ebay-store.js [options]
 *
 * Options:
 *   --store <slug>        Storefront slug (default: salvagea)
 *   --seller <username>   Seller username for store-scoped search (default: salvageautopart)
 *   --out <file>          Output URL list (default: ebay-listing-urls.txt)
 *   --state <file>        Checkpoint file (default: .scraper-state/ebay-<store>.json)
 *   --report <file>       Final report JSON (default: .scraper-state/ebay-<store>-report.json)
 *   --target <n>          Expected listing count for progress % (default: 26758)
 *   --tier <name>         Start tier: fetch|headless|headed|cdp (default: headless)
 *   --max-runtime <spec>  e.g. 30m, 6h (default: 6h)
 *   --max-pages <n>       Store pages (default: 200)
 *   --max-kw-pages <n>    Pages per keyword (default: 20)
 *   --keywords <csv>      Override keyword list
 *   --no-keywords         Skip the keyword sweep
 *   --ipg <n>             Items per page (default: 240)
 *   --limit <n>           Max requests this run (debug)
 *   --fresh               Wipe checkpoint and start over
 *
 * Re-running the same command resumes from the checkpoint. Ctrl+C is safe.
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ScrapeEngine, Checkpoint, ebayStoreAdapter } from '../src/index.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const key = a.slice(2);
    if (key === 'fresh' || key === 'no-keywords') { args[key] = true; continue; }
    args[key] = argv[++i];
  }
  return args;
}

function parseDuration(spec, fallbackMs) {
  if (!spec) return fallbackMs;
  const m = String(spec).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = m[2] || 'ms';
  return Math.round(n * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit]);
}

function loadExistingIds(outFile) {
  const ids = new Set();
  if (existsSync(outFile)) {
    for (const line of readFileSync(outFile, 'utf-8').split('\n')) {
      const m = line.match(/\/itm\/(\d{10,15})/);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

async function main() {
  const args = parseArgs(process.argv);
  const store = args.store || 'salvagea';
  const seller = args.seller || 'salvageautopart';
  const outFile = resolve(args.out || 'ebay-listing-urls.txt');
  const stateFile = resolve(args.state || `.scraper-state/ebay-${store}.json`);
  const reportFile = resolve(args.report || `.scraper-state/ebay-${store}-report.json`);
  const target = Number(args.target || 26_758);
  const startTier = args.tier || 'headless';
  const maxRuntimeMs = parseDuration(args['max-runtime'], 6 * 3_600_000);
  const maxRequests = args.limit ? Number(args.limit) : Infinity;

  if (!['fetch', 'headless', 'headed', 'cdp'].includes(startTier)) {
    console.error(`Unknown --tier "${startTier}". Expected fetch|headless|headed|cdp.`);
    process.exit(1);
  }
  if (args.fresh && existsSync(stateFile)) {
    rmSync(stateFile);
    console.log(`Fresh start: removed ${stateFile}`);
  }

  mkdirSync(dirname(stateFile), { recursive: true });

  const seen = loadExistingIds(outFile);
  const checkpoint = Checkpoint.load(stateFile);

  const adapter = ebayStoreAdapter({
    store,
    sellerUsername: seller,
    ipg: Number(args.ipg || 240),
    maxStorePages: Number(args['max-pages'] || 200),
    maxKeywordPages: Number(args['max-kw-pages'] || 20),
    keywords: args.keywords ? String(args.keywords).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    includeKeywords: !args['no-keywords'],
  });

  // Queue is (re)built idempotently; done/queued keys are skipped.
  const queued = checkpoint.enqueue(adapter.buildQueue());

  console.log('=== eBay store scraper (anti-detection engine) ===');
  console.log(`Store:           ${store} (seller: ${seller})`);
  console.log(`Existing URLs:   ${seen.size} / ${target} (${((seen.size / target) * 100).toFixed(1)}%)`);
  console.log(`Queue:           ${checkpoint.size} pending (${queued} newly enqueued, ${checkpoint.doneCount} pages done)`);
  console.log(`Dead letters:    ${checkpoint.deadLetters.length}`);
  console.log(`Start tier:      ${startTier} (auto-escalates fetch → headless → headed → cdp)`);
  console.log(`State:           ${stateFile}`);
  console.log('');

  const startedAt = Date.now();
  let newThisRun = 0;

  const engine = new ScrapeEngine({
    adapter,
    checkpoint,
    startTier,
    maxRuntimeMs,
    maxRequests,
    onItems: async (ids) => {
      const fresh = [];
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          fresh.push(id);
        }
      }
      if (fresh.length) {
        newThisRun += fresh.length;
        appendFileSync(outFile, fresh.map((id) => adapter.toListingUrl(id)).join('\n') + '\n');
      }
    },
    onProgress: ({ item, outcome, found, tier }) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      const pct = ((seen.size / target) * 100).toFixed(1);
      if (outcome === 'ok') {
        console.log(`  [${tier}] ${item.key}: ${found} ids | total ${seen.size} (${pct}%) | ${checkpoint.size} queued | ${elapsed}s`);
      } else {
        console.log(`  [${tier}] ${item.key}: ${outcome} block | ${checkpoint.size} queued | ${elapsed}s`);
      }
    },
  });

  const report = await engine.run();

  // Final output normalization: dedupe + sort (idempotent rewrite).
  const finalUrls = [...seen].sort().map((id) => adapter.toListingUrl(id));
  writeFileSync(outFile, finalUrls.join('\n') + '\n');

  const finalReport = {
    ...report,
    store,
    seller,
    target,
    uniqueListings: finalUrls.length,
    coveragePct: Number(((finalUrls.length / target) * 100).toFixed(2)),
    newThisRun,
    outFile,
    stateFile,
    finishedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, JSON.stringify(finalReport, null, 2));

  console.log('\n==============================');
  console.log(`Status:          ${report.status}`);
  console.log(`Unique listings: ${finalUrls.length} / ${target} (${finalReport.coveragePct}%)`);
  console.log(`New this run:    ${newThisRun}`);
  console.log(`Requests:        ${report.requests} | blocked pages: ${report.blocked} | dead letters: ${report.deadLetters}`);
  console.log(`Final tier:      ${report.finalTier} | per-tier: ${JSON.stringify(report.tierStats)}`);
  console.log(`Report:          ${reportFile}`);
  console.log('==============================');

  // 0 = queue drained, 2 = interrupted/budget (resumable), 1 = never reached here
  process.exit(report.status === 'complete' && report.queueRemaining === 0 && report.deadLetters === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
