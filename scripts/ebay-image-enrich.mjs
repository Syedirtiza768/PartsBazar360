#!/usr/bin/env node

/**
 * eBay Browse API image enrichment for CSV listings.
 *
 * Reads a CSV with missing imageUrls, searches eBay by brand + MPN,
 * and writes back the found image URLs.
 *
 * Usage:
 *   node ebay-image-enrich.mjs [--input path.csv] [--output path.csv] [--dry-run] [--limit N]
 *
 * Env vars required:
 *   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENVIRONMENT (PRODUCTION|SANDBOX)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse, resolve } from 'path';
import axios from 'axios';

// ── Load .env if present ──
function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadDotEnv(resolve(import.meta.dirname ?? '.', '..', '.env'));
loadDotEnv(resolve(import.meta.dirname ?? '.', '..', 'backend', '.env'));
loadDotEnv(resolve(import.meta.dirname ?? '.', '.env'));
loadDotEnv('F:\\apps\\realtrackapp\\.env');
loadDotEnv('F:\\apps\\realtrackapp\\backend\\.env');

// ── CLI args ──
const args = process.argv.slice(2);
function flag(name) { return args.includes(`--${name}`); }
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const INPUT = opt('input', 'F:\\apps\\PartsBazar360\\outputs\\superior-listings-enriched.csv');
const OUTPUT = opt('output', INPUT.replace(/\.csv$/, '-ebay-enriched.csv'));
const DRY_RUN = flag('dry-run');
const LIMIT = parseInt(opt('limit', '0'), 10) || 0;
const RPS = parseFloat(opt('rps', '2'));
const PROGRESS_FILE = INPUT.replace(/\.csv$/, '-enrich-progress.json');

// ── eBay auth ──
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_ENV = (process.env.EBAY_ENVIRONMENT || 'PRODUCTION').toUpperCase();
const EBAY_BASE = EBAY_ENV === 'PRODUCTION' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';

if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
  console.error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in env');
  process.exit(1);
}

let appToken = null;
let tokenExpiry = 0;

async function getAppToken() {
  if (appToken && Date.now() < tokenExpiry) return appToken;
  const creds = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const { data } = await axios.post(
    `${EBAY_BASE}/identity/v1/oauth2/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );
  appToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log(`Got eBay application token (expires in ${data.expires_in}s)`);
  return appToken;
}

// ── Rate limiter ──
const intervalMs = Math.ceil(1000 / RPS);
let lastRequest = 0;
async function rateGate() {
  const now = Date.now();
  const wait = intervalMs - (now - lastRequest);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequest = Date.now();
}

// ── eBay Browse search ──
const searchCache = new Map(); // key: "brand|mpn" -> imageUrl or null
let consecutive429s = 0;
const MAX_CONSECUTIVE_429 = 3;
let dailyCapHit = false;

function preferLarge(url) {
  return url
    .replace(/\/s-l(64|96|140|225|300|400|500)\./gi, '/s-l1600.')
    .replace(/([?&]s-l)(64|96|140|225|300|400|500)(?=\D|$)/gi, '$11600');
}

async function ebaySearch(query, limit = 1) {
  await rateGate();
  const token = await getAppToken();
  const { data } = await axios.get(
    `${EBAY_BASE}/buy/browse/v1/item_summary/search`,
    {
      params: { q: query, limit, filter: 'buyingOptions:{FIXED_PRICE}' },
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15000,
    },
  );
  return data;
}

async function searchEbayImage(brand, mpn) {
  if (dailyCapHit) return null;

  const cacheKey = `${(brand || '').trim().toUpperCase()}|${mpn.trim().toUpperCase()}`;
  if (searchCache.has(cacheKey)) return searchCache.get(cacheKey);

  const queries = [];
  const brandTrim = brand?.trim();
  const mpnTrim = mpn.trim();

  if (brandTrim) queries.push(`${brandTrim} ${mpnTrim}`);
  queries.push(mpnTrim);

  for (const query of queries) {
    try {
      const data = await ebaySearch(query);
      consecutive429s = 0;
      const items = data.itemSummaries ?? [];
      if (items.length > 0) {
        const imgUrl = items[0].image?.imageUrl ?? null;
        const result = imgUrl ? preferLarge(imgUrl) : null;
        if (result) {
          searchCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        consecutive429s++;
        if (consecutive429s >= MAX_CONSECUTIVE_429) {
          dailyCapHit = true;
          console.warn(`\nDaily API cap likely exhausted (${consecutive429s} consecutive 429s). Stopping search.`);
          searchCache.set(cacheKey, null);
          return null;
        }
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '10', 10);
        console.warn(`\nRate limited (429) #${consecutive429s}. Waiting ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return searchEbayImage(brand, mpn); // retry from scratch
      }
      console.warn(`\nSearch failed for "${query}": ${err.message}`);
    }
  }

  searchCache.set(cacheKey, null);
  return null;
}

// ── CSV parsing (handles quoted fields with commas) ──
function parseCSV(text) {
  const lines = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === '\n' && !inQuote) {
      lines.push(current);
      current = '';
      if (text[i + 1] === '\r') i++;
    } else if (ch === '\r' && !inQuote) {
      lines.push(current);
      current = '';
      if (text[i + 1] === '\n') i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  const splitRow = (row) => {
    const cols = [];
    let field = '';
    let q = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (q && row[i + 1] === '"') { field += '"'; i++; }
        else q = !q;
      } else if (ch === ',' && !q) {
        cols.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    cols.push(field);
    return cols;
  };

  const header = splitRow(lines[0]);
  const rows = lines.slice(1).map(splitRow);
  return { header, rows };
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── Progress persistence ──
function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
    } catch { return {}; }
  }
  return {};
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ── Main ──
async function main() {
  console.log(`Input:  ${INPUT}`);
  console.log(`Output: ${OUTPUT}`);
  console.log(`RPS:    ${RPS}`);
  console.log(`Dry run: ${DRY_RUN}`);
  if (LIMIT) console.log(`Limit:  ${LIMIT} rows`);
  console.log('');

  const raw = readFileSync(INPUT, 'utf8');
  const { header, rows } = parseCSV(raw);
  console.log(`Parsed ${rows.length} rows, ${header.length} columns`);

  // Find column indices
  const idx = {};
  header.forEach((h, i) => { idx[h.trim()] = i; });
  const brandIdx = idx['brand'];
  const mpnIdx = idx['mfr_part_number'];
  const imageIdx = idx['imageUrls'];
  const imageSrcIdx = idx['imageSourceUrl'];
  const imageLookupIdx = idx['imageLookupStatus'];

  if (mpnIdx == null || imageIdx == null) {
    console.error('Missing required columns: mfr_part_number, imageUrls');
    process.exit(1);
  }

  // Filter rows missing images
  const missing = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const imgs = (row[imageIdx] || '').trim();
    const status = imageLookupIdx != null ? (row[imageLookupIdx] || '').trim() : '';
    if (!imgs && status === 'not_found') {
      missing.push(i);
    }
  }
  console.log(`Rows missing images: ${missing.length}`);

  // Deduplicate by MPN
  const uniqueMPNs = new Map(); // "brand|mpn" -> first row index
  for (const ri of missing) {
    const brand = (rows[ri][brandIdx] || '').trim();
    const mpn = (rows[ri][mpnIdx] || '').trim();
    if (!mpn) continue;
    const key = `${brand.toUpperCase()}|${mpn.toUpperCase()}`;
    if (!uniqueMPNs.has(key)) uniqueMPNs.set(key, { brand, mpn });
  }
  console.log(`Unique brand+MPN combos to search: ${uniqueMPNs.size}`);
  console.log('');

  if (DRY_RUN) {
    console.log('Dry run — exiting without searching.');
    return;
  }

  // Load progress
  const progress = loadProgress();
  const cached = Object.keys(progress).filter(k => progress[k] != null).length;
  const cachedNull = Object.keys(progress).filter(k => progress[k] === null).length;
  if (cached + cachedNull > 0) {
    console.log(`Resuming: ${cached} found, ${cachedNull} not found in previous run`);
  }

  // Search eBay for each unique MPN
  let searched = 0;
  let found = 0;
  let notFound = 0;
  let skipped = 0;
  const entries = [...uniqueMPNs.entries()];

  if (LIMIT) entries.splice(LIMIT);

  for (const [key, { brand, mpn }] of entries) {
    if (dailyCapHit) break;
    if (progress[key] !== undefined) {
      skipped++;
      if (progress[key]) found++;
      else notFound++;
      continue;
    }

    const imgUrl = await searchEbayImage(brand, mpn);
    progress[key] = imgUrl; // null if not found
    searched++;

    if (imgUrl) {
      found++;
      process.stdout.write(`\r  [${searched + skipped}/${entries.length}] Found ${found} | Not found ${notFound} | "${brand} ${mpn}" => image`);
    } else {
      notFound++;
      process.stdout.write(`\r  [${searched + skipped}/${entries.length}] Found ${found} | Not found ${notFound} | "${brand} ${mpn}" => none  `);
    }

    // Save progress every 50 searches
    if (searched % 50 === 0) saveProgress(progress);
  }

  saveProgress(progress);
  console.log(`\n\nSearch complete: ${found} found, ${notFound} not found out of ${entries.length} unique MPNs`);

  // Apply results back to CSV rows
  let enriched = 0;
  for (const ri of missing) {
    const brand = (rows[ri][brandIdx] || '').trim();
    const mpn = (rows[ri][mpnIdx] || '').trim();
    if (!mpn) continue;
    const key = `${brand.toUpperCase()}|${mpn.toUpperCase()}`;
    const imgUrl = progress[key];
    if (imgUrl) {
      rows[ri][imageIdx] = imgUrl;
      if (imageSrcIdx != null) rows[ri][imageSrcIdx] = 'ebay:browse-search';
      if (imageLookupIdx != null) rows[ri][imageLookupIdx] = 'ebay_matched';
      enriched++;
    }
  }

  // Write output CSV
  const outLines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    outLines.push(row.map(csvEscape).join(','));
  }
  writeFileSync(OUTPUT, outLines.join('\n'), 'utf8');
  console.log(`\nWrote ${OUTPUT} — ${enriched} rows enriched with eBay images`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
