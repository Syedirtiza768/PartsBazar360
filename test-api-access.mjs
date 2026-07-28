import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';

const OUTPUT_FILE = 'ebay-listing-urls.txt';
const SELLER_ID = 'salvageautopart';
const STORE_NAME = 'salvagea';

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

async function fetchStoreItems(offset, limit = 200) {
  const url = `https://www.ebay.com/str/${STORE_NAME}/_i.html?store_cat=0&_ipg=${limit}&_pgn=${Math.floor(offset / limit) + 1}`;

  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    redirect: 'follow',
  });

  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();

  const ids = new Set();
  let m;
  for (const re of [
    /\/itm\/(\d{10,15})/g,
    /"listingId":"(\d{10,15})"/g,
    /"itemId":"(\d{10,15})"/g,
    /itemPage\.item\((\d{10,15})\)/g,
    /data-itemid="(\d{10,15})"/g,
  ]) {
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
  }

  return [...ids];
}

async function main() {
  const startTime = Date.now();
  const existingIds = loadExistingIds();
  console.log(`Starting with ${existingIds.size} existing URLs`);
  console.log(`Need: ${26758 - existingIds.size} more\n`);

  // First, test if we can get any items at all
  console.log('Testing store page access...');
  const testIds = await fetchStoreItems(0, 48);
  console.log(`Test result: ${testIds.length} items\n`);

  if (testIds.length === 0) {
    console.log('Store page returns 0 items via fetch.');
    console.log('The listings are loaded via JavaScript (client-side rendering).');
    console.log('Need a browser-based approach.\n');

    // Try alternative: use eBay's search API endpoint
    console.log('Trying eBay search API...');

    const searchUrl = 'https://www.ebay.com/sch/i.html?_dkr=1&iconV2Request=true&_blrs=recall_filtering&_ssn=salvageautopart&store_cat=0&store_name=salvagea&_oac=1&_ipg=48&_pgn=1';

    const r2 = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });

    console.log(`Search API status: ${r2.status}`);
    if (r2.ok) {
      const html = await r2.text();
      const ids = new Set();
      let m;
      for (const re of [/\/itm\/(\d{10,15})/g, /"listingId":"(\d{10,15})"/g]) {
        while ((m = re.exec(html)) !== null) ids.add(m[1]);
      }
      console.log(`Search API items: ${ids.size}`);
    }

    // Try eBay Browse API (public, no auth needed for search)
    console.log('\nTrying eBay Browse API...');

    const browseUrl = 'https://api.ebay.com/buy/browse/v1/item_summary/search?q=*&filter=seller:{salvageautopart}&limit=200&offset=0';

    const r3 = await fetch(browseUrl, {
      headers: {
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    console.log(`Browse API status: ${r3.status}`);
    if (r3.ok) {
      const data = await r3.json();
      console.log(`Browse API total: ${data.total || 'unknown'}`);
      console.log(`Browse API items: ${data.itemSummaries?.length || 0}`);
    }

    return;
  }

  // If we got items, proceed with scraping
  let consecutiveEmpty = 0;
  let page = 1;

  while (consecutiveEmpty < 3 && page <= 200) {
    try {
      const ids = await fetchStoreItems((page - 1) * 240, 240);

      if (ids.length === 0) {
        consecutiveEmpty++;
        console.log(`  Page ${page}: empty (${consecutiveEmpty}/3)`);
      } else {
        consecutiveEmpty = 0;
        let newCount = 0;
        for (const id of ids) {
          if (!existingIds.has(id)) {
            existingIds.add(id);
            newCount++;
          }
        }
        if (newCount > 0) {
          appendFileSync(OUTPUT_FILE, ids.filter(id => !existingIds.has(id) || true).map(id => `https://www.ebay.com/itm/${id}`).join('\n') + '\n');
        }
        const pct = ((existingIds.size / 26758) * 100).toFixed(1);
        console.log(`  Page ${page}: ${ids.length} found, ${newCount} new | Total: ${existingIds.size} (${pct}%)`);
      }
    } catch (e) {
      console.log(`  Page ${page}: ERROR - ${e.message}`);
      consecutiveEmpty++;
    }

    page++;
    await sleep(800 + Math.random() * 800);
  }

  const finalUrls = [...existingIds].sort().map(id => `https://www.ebay.com/itm/${id}`);
  writeFileSync(OUTPUT_FILE, finalUrls.join('\n') + '\n');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nTotal: ${finalUrls.length} URLs in ${elapsed}s`);
}

main().catch(e => console.error('Fatal:', e.message));
