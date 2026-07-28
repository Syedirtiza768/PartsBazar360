# @repo/scraper-engine

Anti-detection scraping engine for PartsBazar360 ingestion jobs. Built to
replace the ad-hoc root scripts (`scrape-ebay-urls.mjs`, `browser-scraper.mjs`,
`cdp-scraper.mjs`) with one engine that **finishes the job** and **stays
unflagged** while doing it.

## Why it doesn't get flagged

Detection resistance is layered algorithms, not one trick:

| Layer | Algorithm | What it defeats |
|---|---|---|
| Pacing | **AIMD** (additive increase / multiplicative decrease) + full jitter | Rate counters, periodicity analysis |
| Cooldowns | **Decorrelated jitter backoff** (AWS-style `rand(base, prev*3)`) + circuit breaker | Backoff-pattern fingerprinting, hammering an alerted WAF |
| Identity | **Coherent personas**: UA ↔ sec-ch-ua ↔ platform ↔ viewport ↔ timezone ↔ WebGL ↔ hardware sampled as one unit | Cross-signal coherence checks |
| Browser | **Stealth init scripts**: webdriver removal, PluginArray, `window.chrome`, permissions, WebGL vendor/renderer, CDP artifact cleanup | Headless/automation probes |
| Behavior | **Log-normal inter-request timing**, bezier mouse drift, variable-depth scrolling, human-cadence reading pauses | Timing/telemetry models (uniform delays are a signature) |
| Content | **Block heuristics**: status + redirect + CAPTCHA markers (eBay/Cloudflare/PerimeterX/DataDome/Akamai) + yield-anomaly detection | 200-OK challenge pages that naive scrapers miss |
| Escalation | **Strategy ladder**: `fetch → headless → headed → cdp` (real Chrome), auto up on blocks, auto down on sustained success, session burn + rotation between tiers | Costly tiers only when needed; flagged sessions never reused |

## Why it always completes

- **Checkpointed state machine**: every page is `queued → done` or
  `queued → failed×N → deadLetter`, persisted atomically (tmp+rename).
  Ctrl+C, crash, reboot — re-run the same command and it resumes.
- **Dead-letter sweep**: after the queue drains, every dead-lettered page is
  retried once at the top tier. Zero-yield at the top tier = confirmed empty
  (that is how legitimate end-of-results is distinguished from blocking).
- **Never aborts on blocks**: at the top tier a block means bounded cooldown
  and retry, bounded only by `--max-runtime`.
- **Idempotent output**: dedupe + sort on every finalize; existing
  `ebay-listing-urls.txt` is honored as already-collected.

## Usage

From the repo root (Playwright is already a root dependency):

```sh
# Full store discovery (resumable; safe to Ctrl+C and re-run)
npm run scrape:ebay

# Options
node packages/scraper-engine/cli/ebay-store.js \
  --store salvagea --seller salvageautopart \
  --target 26758 \
  --tier headless \          # or fetch | headed | cdp
  --max-runtime 6h \
  --limit 5                  # debug: stop after 5 requests
```

Outputs:

- `ebay-listing-urls.txt` — same contract as the old scripts (one
  `https://www.ebay.com/itm/<id>` per line), so the existing RealTrack/seed
  pipeline consumes it unchanged.
- `.scraper-state/ebay-<store>.json` — checkpoint (delete or pass `--fresh`
  to start over).
- `.scraper-state/ebay-<store>-report.json` — run report: coverage, per-tier
  stats, blocked pages, dead letters.

Exit codes: `0` fully drained, `2` interrupted/budget-exhausted (resumable),
`1` fatal.

## Programmatic use

```js
import { ScrapeEngine, Checkpoint, ebayStoreAdapter } from '@repo/scraper-engine';

const checkpoint = Checkpoint.load('.scraper-state/job.json');
const adapter = ebayStoreAdapter({ store: 'salvagea', sellerUsername: 'salvageautopart' });
checkpoint.enqueue(adapter.buildQueue());

const engine = new ScrapeEngine({
  adapter,
  checkpoint,
  startTier: 'headless',
  onItems: async (ids) => { /* persist ids */ },
});
const report = await engine.run();
```

Writing a new target adapter requires five functions: `buildQueue()`,
`extractFromHtml(html, item)`, optionally `extractFromPage(page, item)`,
`expectedMin(item)`, `allowEmpty(item)`. The engine handles everything else.

## Honest limits

No scraper can *guarantee* zero flags — eBay's risk model includes IP
reputation, account history, and global traffic shape. What this engine does
guarantee: detection signals are caught early (soft blocks before IP bans),
identity/pacing adapt automatically, escalation climbs to a real browser when
needed, and the job runs to completion across restarts. If the target demands
login or serves hard IP bans, the CDP tier (your real, logged-in Chrome) is
the final answer — and the report will say exactly which pages resisted.
