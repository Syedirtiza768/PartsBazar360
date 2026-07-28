import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import http from 'http';

const OUTPUT_FILE = 'ebay-listing-urls.txt';
const STORE_URL = 'https://www.ebay.com/str/salvagea';
const ITEMS_PER_PAGE = 240;

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

function cdpRequest(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 30000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ id, method, params }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === id) {
        clearTimeout(timeout);
        ws.close();
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };

    ws.onerror = (e) => { clearTimeout(timeout); reject(e); };
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const startTime = Date.now();
  const existingIds = loadExistingIds();
  console.log(`Existing URLs: ${existingIds.size} / 26,758`);
  console.log(`Remaining: ~${26758 - existingIds.size}\n`);

  // Check if Chrome has debugging port open
  let debugUrl;
  try {
    const targets = await httpGet('http://127.0.0.1:9222/json');
    console.log(`Found ${targets.length} Chrome debugging targets`);
    const pageTarget = targets.find(t => t.type === 'page');
    if (pageTarget) {
      debugUrl = pageTarget.webSocketDebuggerUrl;
      console.log(`Page target: ${pageTarget.url}`);
    }
  } catch {
    console.log('Chrome debugging port not found on 9222.');
    console.log('Trying to launch Chrome with debugging port...\n');

    try {
      execSync('start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --no-first-run --no-default-browser-check', {
        detached: true,
        stdio: 'ignore',
      });
      console.log('Chrome launched. Waiting for debugging port...');
      await sleep(5000);

      const targets = await httpGet('http://127.0.0.1:9222/json');
      console.log(`Found ${targets.length} targets`);
      const pageTarget = targets.find(t => t.type === 'page');
      if (pageTarget) {
        debugUrl = pageTarget.webSocketDebuggerUrl;
      }
    } catch (e) {
      console.log('Failed to launch Chrome with debugging:', e.message);
    }
  }

  if (!debugUrl) {
    console.log('\nCannot connect to Chrome debugger.');
    console.log('\nAlternative: Launch Chrome manually with debugging enabled:');
    console.log('1. Close all Chrome windows');
    console.log('2. Run: chrome.exe --remote-debugging-port=9222');
    console.log('3. Log in to eBay in the opened Chrome');
    console.log('4. Re-run this script\n');
    return;
  }

  console.log(`\nConnected to Chrome debugger: ${debugUrl}\n`);

  // Navigate to eBay store and extract items using CDP
  async function navigateAndExtract(url) {
    const result = await cdpRequest(debugUrl, 'Page.navigate', { url });
    await sleep(5000); // Wait for page load and JS execution

    const evalResult = await cdpRequest(debugUrl, 'Runtime.evaluate', {
      expression: `
        (() => {
          const ids = new Set();
          document.querySelectorAll('a[href*="/itm/"]').forEach(a => {
            const m = a.href.match(/\\/itm\\/(\\d{10,15})/);
            if (m) ids.add(m[1]);
          });
          const html = document.body.innerHTML;
          let m;
          const r1 = /\\/itm\\/(\\d{10,15})/g;
          while ((m = r1.exec(html)) !== null) ids.add(m[1]);
          const r2 = /"listingId":"(\\d{10,15})"/g;
          while ((m = r2.exec(html)) !== null) ids.add(m[1]);
          const r3 = /"itemId":"(\\d{10,15})"/g;
          while ((m = r3.exec(html)) !== null) ids.add(m[1]);
          return JSON.stringify([...ids]);
        })()
      `,
      returnByValue: true,
    });

    try {
      return JSON.parse(evalResult.result.value);
    } catch {
      return [];
    }
  }

  // Test first
  console.log('Testing store page...');
  const testIds = await navigateAndExtract(`${STORE_URL}?_ipg=48&_pgn=1`);
  console.log(`Test: ${testIds.length} items found\n`);

  if (testIds.length === 0) {
    console.log('No items found. eBay may be blocking or showing CAPTCHA.');
    console.log('Please check the Chrome window for any security prompts.');
    return;
  }

  // Scrape remaining pages
  let consecutiveEmpty = 0;
  let page = 1;

  while (consecutiveEmpty < 3 && page <= 200) {
    const url = `${STORE_URL}?_ipg=${ITEMS_PER_PAGE}&_pgn=${page}`;

    try {
      const ids = await navigateAndExtract(url);

      if (ids.length === 0) {
        consecutiveEmpty++;
        console.log(`  Page ${page}: empty (${consecutiveEmpty}/3)`);
      } else {
        consecutiveEmpty = 0;
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
        const pct = ((existingIds.size / 26758) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`  Page ${page}: ${ids.length} found, ${newCount} new | Total: ${existingIds.size} (${pct}%) | ${elapsed}s`);
      }
    } catch (e) {
      console.log(`  Page ${page}: ERROR - ${e.message}`);
      consecutiveEmpty++;
    }

    page++;
    await sleep(1000 + Math.random() * 1000);
  }

  const finalUrls = [...existingIds].sort().map(id => `https://www.ebay.com/itm/${id}`);
  writeFileSync(OUTPUT_FILE, finalUrls.join('\n') + '\n');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nTotal: ${finalUrls.length} URLs in ${elapsed}s`);
}

main().catch(e => console.error('Fatal:', e.message));
