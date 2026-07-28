import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const STORE_URL = 'https://www.ebay.com/str/salvagea';
const ITEMS_PER_PAGE = 240;
const OUTPUT_FILE = 'ebay-listing-urls.txt';
const STATE_DIR = '.ebay-scraper';
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
  return { lastStorePage: 0, keywordsDone: [] };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getChromeCookies() {
  const cookiePath = join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies');
  if (!existsSync(cookiePath)) {
    const alt = join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default', 'Cookies');
    if (existsSync(alt)) return alt;
    return null;
  }
  return cookiePath;
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
  console.log('=== eBay Browser Scraper (headless) ===\n');

  const existingIds = loadExistingIds();
  console.log(`Existing URLs: ${existingIds.size} / 26,758 target`);
  console.log(`Remaining: ~${26758 - existingIds.size}\n`);

  const state = loadState();
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

  // Block unnecessary resources for speed
  await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf}', route => route.abort());
  await page.route('**/tracking/**', route => route.abort());
  await page.route('**/beacon/**', route => route.abort());

  // Test connection
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
    console.log('\nTrying with different approach...');
  }

  let startPage = state.lastStorePage > 0 ? state.lastStorePage + 1 : 1;
  let consecutiveEmpty = 0;

  console.log(`--- Phase 1: Store pages from ${startPage} ---\n`);

  for (let pg = startPage; pg <= 200; pg++) {
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

      state.lastStorePage = pg;
      saveState(state);

      const pct = ((existingIds.size / 26758) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  Page ${pg}: ${ids.length} found, ${newCount} new | Total: ${existingIds.size} (${pct}%) | ${elapsed}s`);

    } catch (e) {
      console.log(`  Page ${pg}: ERROR - ${e.message}`);
      consecutiveEmpty++;
      if (consecutiveEmpty >= 5) break;
    }

    await sleep(600 + Math.random() * 600);
  }

  console.log(`\n--- Phase 2: Keyword search ---\n`);

  const keywords = [
    'engine', 'gearbox', 'transmission', 'headlight', 'bumper', 'door',
    'mirror', 'seat', 'wheel', 'brake', 'suspension', 'radiator',
    'alternator', 'starter', 'turbo', 'exhaust', 'fuel pump', 'sensor',
    'ECU', 'wiring', 'grille', 'fender', 'hood', 'trunk',
    'Mercedes', 'BMW', 'Audi', 'Volkswagen', 'Porsche', 'Lexus',
    'Toyota', 'Honda', 'Ford', 'Chevrolet', 'Dodge', 'Jeep',
    'Land Rover', 'Jaguar', 'Volvo', 'Mini', 'Maserati', 'Cadillac',
    'C350', 'E350', 'ML350', '335i', '528i', 'X5',
    'A4', 'A6', 'Q5', 'Q7', 'TT',
    'Golf', 'Jetta', 'Passat', 'Tiguan',
    'Cayenne', 'Panamera', '911',
    'IS250', 'RX350', 'LS460',
    'Camry', 'Civic', 'Mustang', 'Camaro', 'Charger',
    'Range Rover', 'Evoque', 'XF',
    'XC60', 'XC90', 'Cooper', 'Ghibli', 'CTS', 'Escalade',
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
        '_ssn': 'salvageautopart', 'store_cat': '0', 'store_name': 'salvagea',
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

    if (kwNew > 0) {
      kwStale = 0;
      const pct = ((existingIds.size / 26758) * 100).toFixed(1);
      console.log(`  "${kw}": +${kwNew} new | Total: ${existingIds.size} (${pct}%)`);
    } else {
      kwStale++;
      if (kwStale >= 6) {
        console.log(`  6 keywords with no new items. Stopping.`);
        break;
      }
    }
  }

  const finalUrls = [...existingIds].sort().map(id => `https://www.ebay.com/itm/${id}`);
  writeFileSync(OUTPUT_FILE, finalUrls.join('\n') + '\n');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('\n==============================');
  console.log(`Total unique URLs: ${finalUrls.length} / 26,758`);
  console.log(`Coverage: ${((finalUrls.length / 26758) * 100).toFixed(1)}%`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Time: ${elapsed}s`);
  console.log('==============================');

  await browser.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
