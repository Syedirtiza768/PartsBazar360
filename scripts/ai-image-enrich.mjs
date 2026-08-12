#!/usr/bin/env node

/**
 * AI-assisted image enrichment for Superior Auto Parts listings with no image.
 *
 * Default mode uses OpenRouter web search: AI searches the web, chooses a
 * source page using the full listing row, then this script extracts the image
 * URL when the AI returned a source page rather than a direct image.
 *
 * Optional mode: eBay Browse can supply candidates, but OpenRouter still
 * decides whether a candidate actually matches the part.
 *
 * Usage:
 *   node scripts/ai-image-enrich.mjs --input outputs/superior_missing_image_url_listings.csv --limit 100
 *
 * Required:
 *   OPENROUTER_API_KEY
 *
 * Optional candidate source:
 *   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENVIRONMENT
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

loadDotEnv(resolve('.env'));
loadDotEnv(resolve('apps/api/.env'));

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const INPUT = opt('input', 'outputs/superior_missing_image_url_listings.csv');
const OUTPUT = opt('output', INPUT.replace(/\.csv$/i, '-ai-enriched.csv'));
const PROGRESS_FILE = opt('progress', OUTPUT.replace(/\.csv$/i, '.progress.json'));
const SOURCE = opt('source', 'openrouter-web'); // openrouter-web | ebay-ai
const LIMIT = Number(opt('limit', '0')) || 0;
const RPS = Number(opt('rps', '0.5')) || 0.5;
const CONCURRENCY = Math.max(1, Number(opt('concurrency', '1')) || 1);
const LOG_EVERY = Math.max(1, Number(opt('log-every', '10')) || 10);
const SAVE_EVERY = Math.max(1, Number(opt('save-every', '100')) || 100);
const CANDIDATE_LIMIT = Math.max(1, Number(opt('candidate-limit', '8')) || 8);
const SEARCH_ENGINE = opt('search-engine', 'native'); // auto | native | exa | parallel | perplexity | firecrawl
const FETCH_ENGINE = opt('fetch-engine', 'openrouter'); // auto | native | exa | openrouter | parallel | firecrawl
const USE_WEB_FETCH = flag('web-fetch');
const DRY_RUN = flag('dry-run');
const SKIP_URL_VALIDATION = flag('skip-url-validation');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = opt('model', process.env.AI_IMAGE_ENRICH_MODEL || 'openai/gpt-4.1-mini');
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_ENV = (process.env.EBAY_ENVIRONMENT || 'PRODUCTION').toUpperCase();
const EBAY_BASE = EBAY_ENV === 'SANDBOX' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

if (!OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY in environment.');
  process.exit(1);
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }

  const header = rows.shift() || [];
  return { header, rows };
}

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function headerIndex(header) {
  const idx = {};
  header.forEach((h, i) => {
    idx[h.trim()] = i;
  });
  return idx;
}

function ensureColumn(header, rows, name) {
  let idx = header.indexOf(name);
  if (idx >= 0) return idx;
  idx = header.length;
  header.push(name);
  for (const row of rows) row[idx] = '';
  return idx;
}

function cell(row, idx, name) {
  const i = idx[name];
  return i == null ? '' : String(row[i] || '').trim();
}

function cleanPartNumber(raw) {
  return String(raw || '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactTitle(title) {
  return String(title || '')
    .replace(/\s+[–-]\s+[A-Z0-9][A-Z0-9 ._-]{2,}$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildQueries(listing) {
  const brand = listing.brand || listing.manufacturer || '';
  const mpn = listing.mfr_part_number || listing.genuine_oem_part_number || listing.seller_sku || '';
  const oe = listing.oe_numbers || listing.genuine_oem_part_number || '';
  const title = compactTitle(listing.title);
  const type = listing.category_group || listing.category || listing.part_type || '';

  const candidates = [
    [brand, mpn, type].filter(Boolean).join(' '),
    [brand, mpn, 'auto part'].filter(Boolean).join(' '),
    [mpn, title].filter(Boolean).join(' '),
    [oe, title].filter(Boolean).join(' '),
    [title, brand].filter(Boolean).join(' '),
  ]
    .map((q) => q.replace(/\s+/g, ' ').trim())
    .filter((q) => q.length >= 3);

  return [...new Set(candidates)].slice(0, 5);
}

let lastRequest = 0;
let rateTail = Promise.resolve();
async function rateGate() {
  let release;
  const previous = rateTail;
  rateTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  const interval = Math.ceil(1000 / RPS);
  const wait = interval - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((resolveWait) => setTimeout(resolveWait, wait));
  lastRequest = Date.now();
  release();
}

let ebayToken = null;
let ebayTokenExpiry = 0;
async function getEbayToken() {
  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) return null;
  if (ebayToken && Date.now() < ebayTokenExpiry) return ebayToken;
  const creds = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${EBAY_BASE}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`eBay token ${res.status}: ${body}`);
  const data = JSON.parse(body);
  ebayToken = data.access_token;
  ebayTokenExpiry = Date.now() + (Number(data.expires_in || 3600) - 60) * 1000;
  return ebayToken;
}

function preferLargeImage(url) {
  return String(url || '')
    .replace(/\/s-l(64|96|140|225|300|400|500|800)\./gi, '/s-l1600.')
    .trim();
}

async function searchEbayCandidates(queries) {
  const token = await getEbayToken();
  if (!token) return [];

  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    await rateGate();
    const url = new URL(`${EBAY_BASE}/buy/browse/v1/item_summary/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(CANDIDATE_LIMIT));
    url.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE}');
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        Accept: 'application/json',
      },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`eBay search ${res.status}: ${body}`);
    const data = JSON.parse(body);
    for (const item of data.itemSummaries || []) {
      const imageUrl = preferLargeImage(item.image?.imageUrl);
      if (!imageUrl || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      candidates.push({
        source: 'ebay:browse-search',
        query,
        title: item.title || '',
        imageUrl,
        itemWebUrl: item.itemWebUrl || '',
        price: item.price ? `${item.price.value || ''} ${item.price.currency || ''}`.trim() : '',
        condition: item.condition || '',
      });
      if (candidates.length >= CANDIDATE_LIMIT) return candidates;
    }
  }
  return candidates;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`AI response did not contain JSON: ${raw.slice(0, 300)}`);
    return JSON.parse(match[0]);
  }
}

async function aiChooseImage(listing, candidates) {
  await rateGate();
  const messages = [
    {
      role: 'system',
      content:
        'You are a cautious auto-parts image matching assistant. Pick an image only when the candidate clearly matches the requested part identity. Prefer exact manufacturer part number, OEM number, brand, and product type matches. Reject generic, unrelated, vehicle-only, logo, diagram-only, or uncertain results.',
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          task:
            'Select the best image candidate for this marketplace listing. Return only JSON with keys: status ("matched"|"no_confident_match"), imageUrl, sourceUrl, source, query, confidence (0-1), reason.',
          listing,
          candidates,
        },
        null,
        2,
      ),
    },
  ];

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://partsbazar360.com',
      'X-Title': 'PartsBazar360 AI image enrichment',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body}`);
  const data = JSON.parse(body);
  const content = data.choices?.[0]?.message?.content || '';
  return extractJson(content);
}

async function aiFindImageWithWebSearch(listing, queries) {
  await rateGate();
  const messages = [
    {
      role: 'system',
      content:
        'You are a cautious auto-parts image research assistant. Use web search to find a product page or image source for the exact requested part. Prefer exact manufacturer part number, OEM number, brand/manufacturer, and product type matches. Reject uncertain matches. Return only JSON.',
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          task:
            'Search the web and find a correct image for this auto part. Return JSON with keys: status ("matched"|"no_confident_match"), imageUrl, sourceUrl, source, query, confidence (0-1), reason. If current_image_urls is present, find a distinct additional image and do not return one of the current image URLs. Prefer a real product/source page over a guessed CDN path: if you find a strong source page but not a direct image URL, leave imageUrl blank and put the product/source page in sourceUrl.',
          listing,
          suggestedQueries: queries,
          matchingRules: [
            'Exact part number match is strongest evidence.',
            'Brand/manufacturer should match or be a known label from the title.',
            'Product type/category must match the listing.',
            'Do not use a generic vehicle photo, brand logo, placeholder, or unrelated part.',
            'Do not return a URL already listed in current_image_urls; existing images are already primary and this result will be secondary.',
            'If web fetch is available, fetch the product/source page before returning it so you do not return a 404 or invented page.',
            'When unsure, return no_confident_match.',
          ],
        },
        null,
        2,
      ),
    },
  ];

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://partsbazar360.com',
      'X-Title': 'PartsBazar360 AI image enrichment',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
      tools: [
        {
          type: 'openrouter:web_search',
          parameters: {
            engine: SEARCH_ENGINE,
            max_results: Math.min(CANDIDATE_LIMIT, 10),
            max_total_results: CANDIDATE_LIMIT,
            search_context_size: 'low',
          },
        },
        ...(USE_WEB_FETCH
          ? [
              {
                type: 'openrouter:web_fetch',
                parameters: {
                  engine: FETCH_ENGINE,
                  max_uses: 3,
                  max_content_tokens: 12000,
                },
              },
            ]
          : []),
      ],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`OpenRouter web search ${res.status}: ${body}`);
  const data = JSON.parse(body);
  const content = data.choices?.[0]?.message?.content || '';
  const result = extractJson(content);
  return {
    status: result.status === 'matched' ? 'matched' : 'no_confident_match',
    imageUrl: result.imageUrl || '',
    sourceUrl: result.sourceUrl || '',
    source: result.source || 'openrouter:web_search',
    query: result.query || queries[0] || '',
    confidence: Number(result.confidence || 0),
    reason: result.reason || '',
    candidateCount: CANDIDATE_LIMIT,
    usage: data.usage || null,
  };
}

function absolutizeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return '';
  }
}

function extractImageFromHtml(html, baseUrl) {
  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
    /"image"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*\[\s*"([^"]+)"/i,
  ];
  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    const url = match?.[1] ? absolutizeUrl(match[1].replace(/\\\//g, '/'), baseUrl) : '';
    if (looksLikeImageUrl(url)) return url;
  }

  const imgMatches = [...html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)]
    .map((m) => absolutizeUrl(m[1], baseUrl))
    .filter(looksLikeImageUrl)
    .filter((u) => !/logo|sprite|placeholder|spinner|icon|avatar/i.test(u));

  return imgMatches[0] || '';
}

function looksLikeImageUrl(url) {
  return /^https?:\/\//i.test(url) && /\.(jpe?g|png|webp)(?:[?#].*)?$/i.test(url);
}

async function validateImageUrl(url) {
  const target = String(url || '').trim();
  if (!target || isSvgLikeUrl(target)) {
    return { ok: false, reason: 'URL is empty or SVG.' };
  }

  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(target, {
        method,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; PartsBazar360ImageLookup/1.0; +https://partsbazar360.com)',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          ...(method === 'GET' ? { Range: 'bytes=0-2047' } : {}),
        },
        redirect: 'follow',
      });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && contentType.startsWith('image/') && !contentType.includes('svg')) {
        return { ok: true, reason: `${res.status} ${contentType}` };
      }
      if (method === 'GET') {
        return {
          ok: false,
          reason: `HTTP ${res.status}; content-type ${contentType || 'unknown'}`,
        };
      }
    } catch (err) {
      if (method === 'GET') return { ok: false, reason: err.message || String(err) };
    }
  }

  return { ok: false, reason: 'URL did not validate as a raster image.' };
}

function isSvgLikeUrl(url) {
  return /\.svg(?:[?#].*)?$/i.test(String(url || '')) ||
    /\/(?:placeholder|infographic)\.svg(?:[?#].*)?$/i.test(String(url || ''));
}

async function fetchSourceImage(sourceUrl) {
  if (!sourceUrl || looksLikeImageUrl(sourceUrl)) return sourceUrl || '';
  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; PartsBazar360ImageLookup/1.0; +https://partsbazar360.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) return '';
  const contentType = res.headers.get('content-type') || '';
  if (contentType.startsWith('image/') && !contentType.toLowerCase().includes('svg')) return sourceUrl;
  const html = await res.text();
  return extractImageFromHtml(html, sourceUrl);
}

function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function main() {
  const raw = readFileSync(INPUT, 'utf8');
  const { header, rows } = parseCSV(raw);
  const idx = headerIndex(header);

  const foundIdx = ensureColumn(header, rows, 'found_image_url');
  const sourceUrlIdx = ensureColumn(header, rows, 'image_source_url');
  const statusIdx = ensureColumn(header, rows, 'image_lookup_status');
  const queryIdx = ensureColumn(header, rows, 'image_lookup_query');
  const confidenceIdx = ensureColumn(header, rows, 'image_match_confidence');
  const reasonIdx = ensureColumn(header, rows, 'image_match_reason');
  const candidateIdx = ensureColumn(header, rows, 'image_candidate_count');
  const reviewLabelIdx = ensureColumn(header, rows, 'image_review_label');

  const progress = loadProgress();
  const targetRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => !String(row[foundIdx] || '').trim())
    .filter(({ row }) => {
      const status = String(row[statusIdx] || '').trim();
      return !status || status === 'pending' || status === 'not_found' || status === 'error';
    });

  const work = LIMIT ? targetRows.slice(0, LIMIT) : targetRows;
  console.log(`Input rows: ${rows.length}`);
  console.log(`Rows needing lookup: ${targetRows.length}`);
  console.log(`Rows in this run: ${work.length}`);
  console.log(`Output: ${OUTPUT}`);
  console.log(`AI model: ${OPENROUTER_MODEL}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Log every: ${LOG_EVERY}`);
  console.log(`Candidate source: ${SOURCE === 'ebay-ai' ? 'eBay Browse API + AI validation' : 'OpenRouter web search + image extraction'}`);
  if (SOURCE === 'openrouter-web') {
    console.log(`OpenRouter search engine: ${SEARCH_ENGINE}`);
    console.log(`OpenRouter web fetch: ${USE_WEB_FETCH ? FETCH_ENGINE : 'off'}`);
  }

  if (DRY_RUN) {
    const sample = work.slice(0, 3).map(({ row }) => {
      const listing = rowToListing(row, idx);
      return { listing, queries: buildQueries(listing) };
    });
    console.log(JSON.stringify(sample, null, 2));
    return;
  }

  let matched = 0;
  let noMatch = 0;
  let errors = 0;
  let completed = 0;
  let cursor = 0;

  async function processRow(row, rowIndex) {
    const listing = rowToListing(row, idx);
    const progressKey = listing.listing_id || `${listing.mfr_part_number}|${listing.title}|${rowIndex}`;

    try {
      let result = progress[progressKey];
      if (!result) {
        const queries = buildQueries(listing);
        if (SOURCE === 'ebay-ai') {
          const candidates = await searchEbayCandidates(queries);
          if (candidates.length === 0) {
            result = {
              status: 'no_confident_match',
              imageUrl: '',
              sourceUrl: '',
              source: '',
              query: queries[0] || '',
              confidence: 0,
              reason: 'No image candidates returned by configured search source.',
              candidateCount: 0,
            };
          } else {
            const ai = await aiChooseImage(listing, candidates);
            result = {
              status: ai.status === 'matched' && ai.imageUrl ? 'matched' : 'no_confident_match',
              imageUrl: ai.imageUrl || '',
              sourceUrl: ai.sourceUrl || candidates.find((c) => c.imageUrl === ai.imageUrl)?.itemWebUrl || '',
              source: ai.source || candidates.find((c) => c.imageUrl === ai.imageUrl)?.source || '',
              query: ai.query || candidates.find((c) => c.imageUrl === ai.imageUrl)?.query || queries[0] || '',
              confidence: Number(ai.confidence || 0),
              reason: ai.reason || '',
              candidateCount: candidates.length,
            };
          }
        } else {
          result = await aiFindImageWithWebSearch(listing, queries);
          if (result.status === 'matched' && !result.imageUrl && result.sourceUrl) {
            const extracted = await fetchSourceImage(result.sourceUrl);
            if (extracted) {
              result.imageUrl = extracted;
              result.reason = `${result.reason} Extracted image from source page.`.trim();
            }
          }
          if (result.status === 'matched' && !result.imageUrl) {
            result.status = 'no_confident_match';
            result.reason = `${result.reason} No direct image URL could be extracted.`.trim();
          }
        }
        if (result.status === 'matched' && !SKIP_URL_VALIDATION) {
          const validation = await validateImageUrl(result.imageUrl);
          if (!validation.ok) {
            result.status = 'no_confident_match';
            result.reason = `${result.reason} Image URL failed validation: ${validation.reason}`.trim();
          } else {
            result.reason = `${result.reason} Image URL validated: ${validation.reason}`.trim();
          }
        }
        progress[progressKey] = result;
        saveProgress(progress);
      }

      row[foundIdx] = result.status === 'matched' ? result.imageUrl || '' : '';
      row[sourceUrlIdx] = result.sourceUrl || '';
      row[statusIdx] = result.status;
      row[queryIdx] = result.query || '';
      row[confidenceIdx] = result.confidence == null ? '' : String(result.confidence);
      row[reasonIdx] = result.reason || '';
      row[candidateIdx] = String(result.candidateCount ?? '');
      row[reviewLabelIdx] =
        result.status === 'no_confident_match'
          ? 'NEEDS_MANUAL_IMAGE_REVIEW'
          : result.status === 'error'
            ? 'IMAGE_LOOKUP_ERROR'
            : '';

      if (result.status === 'matched') matched++;
      else noMatch++;
    } catch (err) {
      errors++;
      row[statusIdx] = 'error';
      row[reasonIdx] = err.message || String(err);
      row[reviewLabelIdx] = 'IMAGE_LOOKUP_ERROR';
      progress[progressKey] = {
        status: 'error',
        reason: err.message || String(err),
      };
      saveProgress(progress);
    }

    completed++;
    if (completed % SAVE_EVERY === 0 || completed === work.length) {
      writeCsv(OUTPUT, header, rows);
    }
    if (completed % LOG_EVERY === 0 || completed === work.length) {
      console.log(`Progress ${completed}/${work.length} | matched ${matched} | no match ${noMatch} | errors ${errors}`);
    }
  }

  async function worker() {
    while (cursor < work.length) {
      const item = work[cursor++];
      await processRow(item.row, item.rowIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, work.length) }, () => worker()),
  );

  writeCsv(OUTPUT, header, rows);
  console.log(`Done. Wrote ${OUTPUT}`);
}

function rowToListing(row, idx) {
  const listing = {
    listing_id: cell(row, idx, 'listing_id'),
    canonical_part_id: cell(row, idx, 'canonical_part_id'),
    title: cell(row, idx, 'title'),
    brand: cell(row, idx, 'brand'),
    manufacturer: cell(row, idx, 'manufacturer'),
    mfr_part_number: cleanPartNumber(cell(row, idx, 'mfr_part_number')),
    genuine_oem_part_number: cleanPartNumber(cell(row, idx, 'genuine_oem_part_number')),
    oe_numbers: cell(row, idx, 'oe_numbers'),
    category: cell(row, idx, 'category'),
    category_group: cell(row, idx, 'category_group'),
    part_type: cell(row, idx, 'part_type'),
    condition: cell(row, idx, 'condition'),
    part_source: cell(row, idx, 'part_source'),
    quality_tier: cell(row, idx, 'quality_tier'),
    seller_sku: cleanPartNumber(cell(row, idx, 'seller_sku')),
    description: cell(row, idx, 'description').slice(0, 1000),
    item_specifics_json: cell(row, idx, 'item_specifics_json').slice(0, 2000),
    current_image_urls: cell(row, idx, 'current_image_urls'),
  };
  return listing;
}

function writeCsv(path, header, rows) {
  const lines = [header.map(csvEscape).join(',')];
  for (const row of rows) lines.push(header.map((_, i) => csvEscape(row[i] || '')).join(','));
  writeFileSync(path, lines.join('\n'), 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
