import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

const STORE_URL = 'https://www.ebay.com/str/blacklineusedautoparts';
const TOTAL_ITEMS = 35968;
const ITEMS_PER_PAGE = 240;
const OUTPUT_FILE = 'ebay-blackline-urls.txt';
const STATE_DIR = '.ebay-scraper-blackline';
const STATE_FILE = join(STATE_DIR, 'state.json');

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadExistingIds() {
  const ids = new Set();
  if (existsSync(OUTPUT_FILE)) {
    readFileSync(OUTPUT_FILE, 'utf-8').split('\n').filter(Boolean).forEach(line => {
      const m = line.match(/\/itm\/(\d+)/);
      if (m) ids.add(m[1]);
    });
  }
  return ids;
}

function loadState() {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch {}
  }
  return { lastStorePage: 0, keywordsDone: [], startTime: Date.now() };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatETA(remainingMs) {
  const s = Math.floor(remainingMs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `~${h}h ${m % 60}m`;
  if (m > 0) return `~${m}m`;
  return `~${s}s`;
}

async function extractItemIds(page) {
  return page.evaluate(() => {
    const ids = new Set();
    document.querySelectorAll('a[href*="/itm/"]').forEach(a => {
      const m = a.href.match(/\/itm\/(\d{10,15})/);
      if (m) ids.add(m[1]);
    });
    const html = document.body.innerHTML;
    let m;
    for (const re of [
      /\/itm\/(\d{10,15})/g,
      /"listingId":"(\d{10,15})"/g,
      /"itemId":"(\d{10,15})"/g,
    ]) { while ((m = re.exec(html)) !== null) ids.add(m[1]); }
    return [...ids];
  });
}

async function waitForListings(page, timeout = 25000) {
  try {
    await page.waitForFunction(() =>
      document.querySelectorAll('a[href*="/itm/"]').length > 0 ||
      document.querySelectorAll('.s-item__link').length > 0
    , { timeout });
    await sleep(2000);
    return true;
  } catch { return false; }
}

async function main() {
  const startTime = Date.now();
  console.log('=== Blackline eBay Browser Scraper (headless) ===\n');
  console.log(`Target: ${STORE_URL}`);
  console.log(`Total items: ${TOTAL_ITEMS.toLocaleString()}\n`);

  const existingIds = loadExistingIds();
  console.log(`Existing URLs: ${existingIds.size.toLocaleString()} / ${TOTAL_ITEMS.toLocaleString()}`);
  console.log(`Remaining: ~${(TOTAL_ITEMS - existingIds.size).toLocaleString()}\n`);

  const state = loadState();
  state.startTime = state.startTime || startTime;
  console.log(`Resuming from store page ${state.lastStorePage + 1}`);
  console.log(`Keywords done: ${state.keywordsDone.length}\n`);

  console.log('Launching headless browser...');
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  const page = await context.newPage();

  await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf}', route => route.abort());
  await page.route('**/tracking/**', route => route.abort());
  await page.route('**/beacon/**', route => route.abort());

  console.log('Testing eBay access...');
  await page.goto(STORE_URL + '?_ipg=48&_pgn=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  const testIds = await extractItemIds(page);
  console.log(`Test page: found ${testIds.length} items\n`);

  if (testIds.length === 0) {
    console.log('WARNING: No items found on test page.');
    console.log('Page title:', await page.title());
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Body preview:', bodyText.substring(0, 200));
    return;
  }

  let startPage = state.lastStorePage > 0 ? state.lastStorePage + 1 : 1;
  let consecutiveEmpty = 0;
  const phase1Start = Date.now();
  let pagesProcessed = 0;

  console.log(`--- Phase 1: Store pages from ${startPage} ---\n`);

  for (let pg = startPage; pg <= 300; pg++) {
    const url = `${STORE_URL}?_ipg=${ITEMS_PER_PAGE}&_pgn=${pg}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const found = await waitForListings(page, 20000);

      if (!found) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) {
          console.log(`  Page ${pg}: 3x empty, stopping store pagination.`);
          break;
        }
        console.log(`  Page ${pg}: empty (${consecutiveEmpty}/3)`);
        continue;
      }

      consecutiveEmpty = 0;
      const ids = await extractItemIds(page);
      let newCount = 0;
      const newIds = [];
      for (const id of ids) {
        if (!existingIds.has(id)) {
          existingIds.add(id);
          newIds.push(id);
          newCount++;
        }
      }

      if (newCount > 0) {
        appendFileSync(OUTPUT_FILE, newIds.map(id => `https://www.ebay.com/itm/${id}`).join('\n') + '\n');
      }

      pagesProcessed++;
      state.lastStorePage = pg;
      saveState(state);

      const elapsed = Date.now() - startTime;
      const rate = existingIds.size / ((Date.now() - state.startTime) / 1000);
      const remaining = TOTAL_ITEMS - existingIds.size;
      const eta = rate > 0 ? remaining / rate * 1000 : 0;
      const pct = ((existingIds.size / TOTAL_ITEMS) * 100).toFixed(1);

      console.log(`  Page ${pg}: ${ids.length} found, ${newCount} new | Total: ${existingIds.size.toLocaleString()} (${pct}%) | ${formatElapsed(elapsed)} | ETA: ${formatETA(eta)}`);

    } catch (e) {
      console.log(`  Page ${pg}: ERROR - ${e.message}`);
      consecutiveEmpty++;
      if (consecutiveEmpty >= 5) break;
    }

    await sleep(600 + Math.random() * 600);
  }

  if (pagesProcessed > 0) {
    const phase1Time = Date.now() - phase1Start;
    console.log(`\nPhase 1 complete: ${pagesProcessed} pages in ${formatElapsed(phase1Time)}`);
    console.log(`Items so far: ${existingIds.size.toLocaleString()} / ${TOTAL_ITEMS.toLocaleString()}\n`);
  }

  console.log(`--- Phase 2: Keyword search ---\n`);

  const keywords = [
    'Audi', 'Bentley', 'BMW', 'Jaguar', 'Maserati', 'McLaren',
    'Mercedes', 'Porsche', 'Range Rover', 'Volkswagen', 'Land Rover',
    'engine', 'gearbox', 'transmission', 'headlight', 'bumper', 'door',
    'mirror', 'seat', 'wheel', 'brake', 'suspension', 'radiator',
    'alternator', 'starter', 'turbo', 'exhaust', 'fuel pump', 'sensor',
    'ECU', 'wiring', 'grille', 'fender', 'hood', 'trunk',
    'A4', 'A6', 'A8', 'Q5', 'Q7', 'Q8', 'TT', 'RS5', 'RS7',
    '3 Series', '5 Series', '7 Series', 'X3', 'X5', 'X6', 'X7',
    'Cayenne', 'Panamera', 'Macan', '911', 'Taycan',
    'E-Class', 'S-Class', 'C-Class', 'GLE', 'GLC', 'AMG',
    'Range Rover Sport', 'Evoque', 'Velar', 'Discovery',
    'Golf', 'Jetta', 'Passat', 'Tiguan', 'Atlas',
    'XF', 'XJ', 'F-Type', 'F-Pace',
    'Ghibli', 'Levante', 'Quattroporte',
    '720S',
    'center console', 'dashboard', 'steering wheel', 'taillight',
    'headlight assembly', 'door panel', 'fender panel',
  ];

  const doneKwSet = new Set(state.keywordsDone);
  let kwStale = 0;

  for (const kw of keywords) {
    if (doneKwSet.has(kw)) continue;

    let pg = 1;
    let kwNew = 0;
    let kwEmpty = 0;

    while (pg <= 20) {
      const params = new URLSearchParams({
        '_dkr': '1', 'iconV2Request': 'true', '_blrs': 'recall_filtering',
        '_ssn': 'blacklineusedautoparts', 'store_cat': '0', 'store_name': 'blacklineusedautoparts',
        '_oac': '1', '_ipg': String(ITEMS_PER_PAGE), '_pgn': String(pg), '_nkw': kw,
      });
      const url = `https://www.ebay.com/sch/i.html?${params.toString()}`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const found = await waitForListings(page, 15000);

        if (!found) {
          kwEmpty++;
          if (kwEmpty >= 2) break;
          pg++;
          continue;
        }

        kwEmpty = 0;
        const ids = await page.evaluate(() => {
          const ids = new Set();
          document.querySelectorAll('.s-item__link').forEach(a => {
            const m = a.href.match(/\/itm\/(\d{10,15})/);
            if (m) ids.add(m[1]);
          });
          if (ids.size === 0) {
            const html = document.body.innerHTML;
            let m;
            const r = /\/itm\/(\d{10,15})/g;
            while ((m = r.exec(html)) !== null) ids.add(m[1]);
          }
          return [...ids];
        });

        for (const id of ids) {
          if (!existingIds.has(id)) {
            existingIds.add(id);
            kwNew++;
            appendFileSync(OUTPUT_FILE, `https://www.ebay.com/itm/${id}\n`);
          }
        }
      } catch (e) {
        kwEmpty++;
      }

      pg++;
      await sleep(600 + Math.random() * 600);
    }

    state.keywordsDone.push(kw);
    saveState(state);

    const elapsed = Date.now() - startTime;
    const rate = existingIds.size / ((Date.now() - state.startTime) / 1000);
    const remaining = TOTAL_ITEMS - existingIds.size;
    const eta = rate > 0 ? remaining / rate * 1000 : 0;
    const pct = ((existingIds.size / TOTAL_ITEMS) * 100).toFixed(1);

    if (kwNew > 0) {
      kwStale = 0;
      console.log(`  "${kw}": +${kwNew} new | Total: ${existingIds.size.toLocaleString()} (${pct}%) | ${formatElapsed(elapsed)} | ETA: ${formatETA(eta)}`);
    } else {
      kwStale++;
      console.log(`  "${kw}": +0 | Total: ${existingIds.size.toLocaleString()} (${pct}%) | stale: ${kwStale}/6`);
      if (kwStale >= 6) {
        console.log(`  6 keywords with no new items. Stopping.`);
        break;
      }
    }
  }

  const finalUrls = [...existingIds].sort().map(id => `https://www.ebay.com/itm/${id}`);
  writeFileSync(OUTPUT_FILE, finalUrls.join('\n') + '\n');

  const elapsed = Date.now() - startTime;
  console.log('\n==============================');
  console.log(`Total unique URLs: ${finalUrls.length.toLocaleString()} / ${TOTAL_ITEMS.toLocaleString()}`);
  console.log(`Coverage: ${((finalUrls.length / TOTAL_ITEMS) * 100).toFixed(1)}%`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Time: ${formatElapsed(elapsed)}`);
  console.log('==============================');

  await browser.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
