import { writeFileSync, appendFileSync, existsSync, readFileSync, unlinkSync } from 'fs';

const STORE_URL = 'https://www.ebay.com/str/salvagea';
const ITEMS_PER_PAGE = 240;
const CONCURRENCY = 3;
const RETRY_COUNT = 3;
const DELAY_BETWEEN_BATCHES = 2000;
const OUTPUT_FILE = 'ebay-listing-urls.txt';
const PROGRESS_FILE = 'ebay-scrape-progress.json';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(pageNum, retries = RETRY_COUNT) {
  const url = `${STORE_URL}?_ipg=${ITEMS_PER_PAGE}&_pgn=${pageNum}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const idSet = new Set();
      let m;

      const r1 = /\/itm\/(\d{10,15})/g;
      while ((m = r1.exec(html)) !== null) idSet.add(m[1]);

      const r2 = /"listingId":"(\d{10,15})"/g;
      while ((m = r2.exec(html)) !== null) idSet.add(m[1]);

      const r3 = /"itemId":"(\d{10,15})"/g;
      while ((m = r3.exec(html)) !== null) idSet.add(m[1]);

      return { pageNum, ids: [...idSet], count: idSet.size };
    } catch (err) {
      if (attempt === retries) {
        console.error(`  Page ${pageNum} FAILED after ${retries} attempts: ${err.message}`);
        return { pageNum, ids: [], count: 0, error: err.message };
      }
      await sleep(3000 * attempt);
    }
  }
}

async function main() {
  const startTime = Date.now();
  console.log('=== eBay Store Listing Scraper ===');
  console.log(`Store: ${STORE_URL}`);
  console.log(`Target: ~26,758 listings\n`);

  const allIds = new Set();
  const failedPages = [];
  let page = 1;
  let consecutiveEmpty = 0;
  const MAX_CONSECUTIVE_EMPTY = 3;

  if (existsSync(OUTPUT_FILE)) unlinkSync(OUTPUT_FILE);
  if (existsSync(PROGRESS_FILE)) unlinkSync(PROGRESS_FILE);

  while (true) {
    const batch = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      batch.push(page + i);
    }

    console.log(`Fetching pages [${batch.join(', ')}]...`);
    const results = await Promise.all(batch.map(pg => fetchPage(pg)));

    let anyItems = false;
    for (const result of results) {
      if (result.error) {
        failedPages.push(result.pageNum);
        console.log(`  Page ${result.pageNum}: FAILED`);
      } else {
        const beforeSize = allIds.size;
        result.ids.forEach(id => allIds.add(id));
        const newCount = allIds.size - beforeSize;
        console.log(`  Page ${result.pageNum}: ${result.count} items (${newCount} new)`);
        if (result.count > 0) anyItems = true;
      }
    }

    if (!anyItems) {
      consecutiveEmpty++;
      console.log(`  Consecutive empty batches: ${consecutiveEmpty}/${MAX_CONSECUTIVE_EMPTY}`);
      if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
        console.log('\nEnd of listings reached.');
        break;
      }
    } else {
      consecutiveEmpty = 0;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((allIds.size / 26758) * 100).toFixed(1);
    console.log(`  Total: ${allIds.size} / ~26,758 (${pct}%) | Elapsed: ${elapsed}s\n`);

    page += batch.length;

    if (page > 200) {
      console.log('Safety limit reached (200 pages).');
      break;
    }

    await sleep(DELAY_BETWEEN_BATCHES);
  }

  if (failedPages.length > 0) {
    console.log(`\nRetrying ${failedPages.length} failed pages...`);
    for (const pg of failedPages) {
      await sleep(3000);
      const result = await fetchPage(pg, 5);
      if (!result.error) {
        result.ids.forEach(id => allIds.add(id));
        console.log(`  Page ${pg}: recovered ${result.count} items`);
      } else {
        console.log(`  Page ${pg}: still failed`);
      }
    }
  }

  const sortedUrls = [...allIds].sort().map(id => `https://www.ebay.com/itm/${id}`);
  writeFileSync(OUTPUT_FILE, sortedUrls.join('\n') + '\n');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== COMPLETE ===');
  console.log(`Total unique listing URLs: ${sortedUrls.length}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Time: ${elapsed}s`);
}

main().catch(console.error);
