#!/usr/bin/env node

/**
 * Cost-optimized product image enrichment.
 *
 * Strategy:
 * 1. Skip rows that already have a usable non-SVG image unless requested.
 * 2. Try free/local exact part-number image artifacts.
 * 3. Try deterministic public image URL patterns for known parts catalogs.
 * 4. If configured, call a cheap image-search API (Brave or SerpApi), validate
 *    direct image URLs, and accept only exact part-number hits.
 *
 * This intentionally keeps expensive AI browsing out of the default path.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
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

const INPUT = opt('input', 'outputs/superior_AAP_pending_image_rows.csv');
const OUTPUT = opt('output', INPUT.replace(/\.csv$/i, '-cost-optimized-images.csv'));
const PROGRESS = opt('progress', OUTPUT.replace(/\.csv$/i, '.progress.json'));
const LIMIT = Number(opt('limit', '0')) || 0;
const CONCURRENCY = Math.max(1, Number(opt('concurrency', '4')) || 4);
const LOG_EVERY = Math.max(1, Number(opt('log-every', '50')) || 50);
const PROVIDER = opt('provider', 'auto'); // auto | none | brave | serpapi
const SEARCH_COUNT = Math.max(1, Math.min(20, Number(opt('search-count', '8')) || 8));
const COUNTRY = opt('country', 'US');
const SEARCH_LANG = opt('search-lang', 'en');
const INCLUDE_EXISTING = flag('include-existing');
const ALLOW_DIAGRAMS = flag('allow-diagrams');

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;

const pricing = {
  braveSearchUsdPerRequest: 0.005,
  serpApiStarterUsdPerRequest: 0.025,
};

if (!existsSync(INPUT)) {
  console.error(`Input not found: ${INPUT}`);
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

function writeCSV(path, header, rows) {
  const lines = [header.map(csvEscape).join(',')];
  for (const row of rows) lines.push(header.map((_, i) => csvEscape(row[i] || '')).join(','));
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
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
  return i == null ? '' : String(row[i] ?? '').trim();
}

function splitUrls(value) {
  return String(value || '')
    .split('|')
    .map((url) => url.trim())
    .filter(Boolean)
    .filter((url) => !/\.svg(?:$|[?#])/i.test(url));
}

function compactPart(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeBrand(brand) {
  const normalized = String(brand || '').trim().toUpperCase();
  const aliases = {
    'MERCEDES BENZ': 'MERCEDES',
    'PEUGEOT/CITROEN': 'PSA',
    'GENERAL MOTORS': 'GM',
    'Genuine OEM': 'OEM',
  };
  return aliases[normalized] || normalized;
}

function listingIdentity(row, idx) {
  const numbers = [
    cell(row, idx, 'mfr_part_number'),
    cell(row, idx, 'genuine_oem_part_number'),
    cell(row, idx, 'seller_sku'),
    ...cell(row, idx, 'oe_numbers').split(/[|,;\s]+/),
  ]
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    listingId: cell(row, idx, 'listing_id'),
    title: cell(row, idx, 'title'),
    brand: cell(row, idx, 'brand'),
    manufacturer: cell(row, idx, 'manufacturer'),
    category: cell(row, idx, 'category'),
    mfrPartNumber: cell(row, idx, 'mfr_part_number'),
    numbers: [...new Set(numbers)],
    compactNumbers: [...new Set(numbers.map(compactPart).filter((v) => v.length >= 4))],
  };
}

function imageLooksBad(url, text = '') {
  const haystack = `${url} ${text}`.toLowerCase();
  if (/\.svg(?:$|[?#])/i.test(url)) return true;
  if (/no[-_\s]?photo|placeholder|coming[-_\s]?soon|logo|favicon|sprite/.test(haystack)) return true;
  if (!ALLOW_DIAGRAMS && /diagram|schema|scheme|schematic|epc/.test(haystack)) return true;
  return false;
}

async function validateImageUrl(url) {
  if (!url || imageLooksBad(url)) return { ok: false, reason: 'empty, svg, placeholder, logo, or diagram' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'PartsBazar360 image enrichment (+https://partsbazar360.com)',
        accept: 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);

    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || !type.startsWith('image/') || type.includes('svg')) {
      return { ok: false, reason: `HTTP ${res.status}; ${type || 'unknown content-type'}` };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1200) return { ok: false, reason: `image too small: ${bytes.length} bytes` };

    const dimensions = imageDimensions(bytes);
    if (!dimensions) return { ok: false, reason: `could not read image dimensions; ${bytes.length} bytes` };
    if (dimensions.width < 80 || dimensions.height < 80) {
      return { ok: false, reason: `image dimensions too small: ${dimensions.width}x${dimensions.height}` };
    }

    return { ok: true, reason: `${res.status} ${type} ${bytes.length} bytes ${dimensions.width}x${dimensions.height}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb ||
        marker === 0xcd ||
        marker === 0xce ||
        marker === 0xcf
      ) {
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }

  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return {
        width: 1 + bytes.readUIntLE(24, 3),
        height: 1 + bytes.readUIntLE(27, 3),
      };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      };
    }
  }

  return null;
}

function loadLocalMpnCandidates() {
  const candidates = new Map();
  const files = ['scripts/matched-images-by-mpn.tsv'];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const [partNumber, imageUrl] = line.split('\t');
      const key = compactPart(partNumber);
      if (key && imageUrl && !candidates.has(key)) {
        candidates.set(key, {
          imageUrl: imageUrl.trim(),
          sourceUrl: '',
          source: `local:${basename(file)}`,
          title: partNumber,
          stage: 'local_exact_mpn',
        });
      }
    }
  }
  return candidates;
}

function partsouqCandidates(identity) {
  const brand = normalizeBrand(identity.brand);
  const folders = [...new Set([brand, identity.brand, identity.manufacturer].map(normalizeBrand).filter(Boolean))];
  const urls = [];
  for (const folder of folders) {
    for (const number of identity.numbers) {
      const raw = String(number || '').trim();
      if (!raw) continue;
      const compact = compactPart(raw);
      const variants = [...new Set([raw, raw.toUpperCase(), compact])];
      for (const variant of variants) {
        urls.push(`https://partsouq.com/assets/tesseract/assets/partsimages/${encodeURIComponent(folder)}/${encodeURIComponent(variant)}-0.jpg`);
        urls.push(`https://partsouq.com/assets/tesseract/assets/partsimages/${encodeURIComponent(folder)}/${encodeURIComponent(variant)}.jpg`);
      }
    }
  }
  return urls.map((imageUrl) => ({
    imageUrl,
    sourceUrl: '',
    source: 'partsouq:deterministic-pattern',
    title: identity.title,
    stage: 'free_pattern_partsouq',
  }));
}

function officialPatternCandidates(identity) {
  return [
    ...partsouqCandidates(identity),
  ];
}

function buildQuery(identity) {
  const part = identity.mfrPartNumber || identity.numbers[0] || '';
  return [
    identity.brand,
    identity.manufacturer && identity.manufacturer !== identity.brand ? identity.manufacturer : '',
    part,
    identity.category && identity.category !== 'General Automotive Parts' ? identity.category : '',
    'part image',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 380);
}

async function braveImageCandidates(identity) {
  if (!BRAVE_SEARCH_API_KEY) return [];
  const url = new URL('https://api.search.brave.com/res/v1/images/search');
  url.searchParams.set('q', buildQuery(identity));
  url.searchParams.set('count', String(SEARCH_COUNT));
  url.searchParams.set('country', COUNTRY);
  url.searchParams.set('search_lang', SEARCH_LANG);
  url.searchParams.set('safesearch', 'strict');
  url.searchParams.set('spellcheck', '1');
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'accept-encoding': 'gzip',
      'x-subscription-token': BRAVE_SEARCH_API_KEY,
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Brave image search ${res.status}: ${body.slice(0, 500)}`);
  const data = JSON.parse(body);
  return (data.results || []).flatMap((item) => {
    const imageUrl = item.properties?.url || item.url || item.thumbnail?.src || item.thumbnail || '';
    const sourceUrl = item.source || item.page_url || item.properties?.source_url || item.link || '';
    return imageUrl
      ? [{
          imageUrl,
          sourceUrl,
          source: 'brave:image-search',
          title: [item.title, item.description, item.source].filter(Boolean).join(' '),
          stage: 'cheap_image_search_brave',
        }]
      : [];
  });
}

async function serpApiImageCandidates(identity) {
  if (!SERPAPI_API_KEY) return [];
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_images');
  url.searchParams.set('q', buildQuery(identity));
  url.searchParams.set('api_key', SERPAPI_API_KEY);
  url.searchParams.set('ijn', '0');
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`SerpApi image search ${res.status}: ${body.slice(0, 500)}`);
  const data = JSON.parse(body);
  return (data.images_results || []).slice(0, SEARCH_COUNT).flatMap((item) => {
    const imageUrl = item.original || item.thumbnail || '';
    return imageUrl
      ? [{
          imageUrl,
          sourceUrl: item.link || '',
          source: `serpapi:google-images${item.source ? `:${item.source}` : ''}`,
          title: [item.title, item.source].filter(Boolean).join(' '),
          stage: 'cheap_image_search_serpapi',
        }]
      : [];
  });
}

async function searchCandidates(identity) {
  if (PROVIDER === 'none') return { candidates: [], providerUsed: 'none', paidRequests: 0 };
  if (PROVIDER === 'brave' || (PROVIDER === 'auto' && BRAVE_SEARCH_API_KEY)) {
    return {
      candidates: await braveImageCandidates(identity),
      providerUsed: 'brave',
      paidRequests: 1,
    };
  }
  if (PROVIDER === 'serpapi' || (PROVIDER === 'auto' && SERPAPI_API_KEY)) {
    return {
      candidates: await serpApiImageCandidates(identity),
      providerUsed: 'serpapi',
      paidRequests: 1,
    };
  }
  return { candidates: [], providerUsed: 'none', paidRequests: 0 };
}

function candidateHasExactIdentity(candidate, identity) {
  const text = compactPart([
    candidate.imageUrl,
    candidate.sourceUrl,
    candidate.source,
    candidate.title,
  ].join(' '));
  return identity.compactNumbers.some((number) => text.includes(number));
}

async function firstValidatedExactCandidate(candidates, identity) {
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = String(candidate.imageUrl || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  for (const candidate of unique) {
    if (imageLooksBad(candidate.imageUrl, `${candidate.title} ${candidate.sourceUrl}`)) continue;
    if (!candidateHasExactIdentity(candidate, identity) && !candidate.stage?.startsWith('free_pattern')) continue;
    const validation = await validateImageUrl(candidate.imageUrl);
    if (!validation.ok) continue;
    const brandText = `${candidate.imageUrl} ${candidate.sourceUrl} ${candidate.title}`.toUpperCase();
    const brand = normalizeBrand(identity.brand);
    return {
      status: 'matched',
      imageUrl: candidate.imageUrl,
      sourceUrl: candidate.sourceUrl,
      source: candidate.source,
      stage: candidate.stage,
      confidence: brand && brandText.includes(brand) ? 0.93 : 0.86,
      reason: `Validated exact part-number image candidate via ${candidate.stage}: ${validation.reason}`,
    };
  }

  return null;
}

function loadProgress() {
  if (!existsSync(PROGRESS)) return {};
  try {
    return JSON.parse(readFileSync(PROGRESS, 'utf8'));
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 2), 'utf8');
}

function estimatedSearchCost(provider, paidRequests) {
  if (provider === 'brave') return paidRequests * pricing.braveSearchUsdPerRequest;
  if (provider === 'serpapi') return paidRequests * pricing.serpApiStarterUsdPerRequest;
  return 0;
}

const { header, rows } = parseCSV(readFileSync(INPUT, 'utf8'));
const idx = headerIndex(header);
const foundIdx = ensureColumn(header, rows, 'found_image_url');
const sourceUrlIdx = ensureColumn(header, rows, 'image_source_url');
const statusIdx = ensureColumn(header, rows, 'image_lookup_status');
const queryIdx = ensureColumn(header, rows, 'image_lookup_query');
const confidenceIdx = ensureColumn(header, rows, 'image_match_confidence');
const reasonIdx = ensureColumn(header, rows, 'image_match_reason');
const candidateIdx = ensureColumn(header, rows, 'image_candidate_count');
const reviewLabelIdx = ensureColumn(header, rows, 'image_review_label');
const strategyIdx = ensureColumn(header, rows, 'image_lookup_strategy');
const estimatedCostIdx = ensureColumn(header, rows, 'estimated_lookup_cost_usd');

const localMpnCandidates = loadLocalMpnCandidates();
const progress = loadProgress();
const targetRows = rows
  .map((row, rowIndex) => ({ row, rowIndex }))
  .filter(({ row }) => INCLUDE_EXISTING || splitUrls(cell(row, idx, 'current_image_urls')).length === 0)
  .filter(({ row }) => !String(row[foundIdx] || '').trim());
const work = LIMIT ? targetRows.slice(0, LIMIT) : targetRows;

let cursor = 0;
let completed = 0;
let matched = 0;
let noMatch = 0;
let errors = 0;
let paidRequests = 0;
let estimatedCost = 0;

console.log(`Input rows: ${rows.length}`);
console.log(`Rows selected: ${work.length}`);
console.log(`Output: ${OUTPUT}`);
console.log(`Provider: ${PROVIDER}`);
console.log(`Keys available: Brave=${Boolean(BRAVE_SEARCH_API_KEY)} SerpApi=${Boolean(SERPAPI_API_KEY)}`);
console.log(`Concurrency: ${CONCURRENCY}`);

async function processItem(row, rowIndex) {
  const identity = listingIdentity(row, idx);
  const key = identity.listingId || `${identity.mfrPartNumber}|${identity.title}|${rowIndex}`;
  let result = progress[key];

  if (!result) {
    try {
      const localCandidates = identity.compactNumbers
        .map((number) => localMpnCandidates.get(number))
        .filter(Boolean);
      result = await firstValidatedExactCandidate(localCandidates, identity);

      if (!result) {
        result = await firstValidatedExactCandidate(officialPatternCandidates(identity), identity);
      }

      if (!result) {
        const searched = await searchCandidates(identity);
        paidRequests += searched.paidRequests;
        estimatedCost += estimatedSearchCost(searched.providerUsed, searched.paidRequests);
        result = await firstValidatedExactCandidate(searched.candidates, identity);
        if (result) {
          result.paidProvider = searched.providerUsed;
          result.estimatedCostUsd = estimatedSearchCost(searched.providerUsed, searched.paidRequests);
        } else {
          result = {
            status: 'no_confident_match',
            imageUrl: '',
            sourceUrl: '',
            source: searched.providerUsed,
            stage: searched.providerUsed === 'none' ? 'no_paid_provider_configured' : `cheap_image_search_${searched.providerUsed}`,
            confidence: 0,
            reason: searched.providerUsed === 'none'
              ? 'No exact local/pattern match found, and no cheap image-search provider key is configured.'
              : 'No validated exact part-number image candidate found from cheap image-search provider.',
            candidateCount: searched.candidates.length,
            paidProvider: searched.providerUsed,
            estimatedCostUsd: estimatedSearchCost(searched.providerUsed, searched.paidRequests),
          };
        }
      }

      result.query = buildQuery(identity);
      result.candidateCount = result.candidateCount ?? '';
      result.estimatedCostUsd = result.estimatedCostUsd ?? 0;
      progress[key] = result;
      saveProgress(progress);
    } catch (error) {
      result = {
        status: 'error',
        imageUrl: '',
        sourceUrl: '',
        source: '',
        stage: 'error',
        confidence: 0,
        reason: error instanceof Error ? error.message : String(error),
        query: buildQuery(identity),
        estimatedCostUsd: 0,
      };
      progress[key] = result;
      saveProgress(progress);
    }
  }

  row[foundIdx] = result.status === 'matched' ? result.imageUrl || '' : '';
  row[sourceUrlIdx] = result.sourceUrl || '';
  row[statusIdx] = result.status;
  row[queryIdx] = result.query || buildQuery(identity);
  row[confidenceIdx] = result.confidence == null ? '' : String(result.confidence);
  row[reasonIdx] = result.reason || '';
  row[candidateIdx] = result.candidateCount == null ? '' : String(result.candidateCount);
  row[reviewLabelIdx] = result.status === 'matched' ? '' : 'NEEDS_MANUAL_IMAGE_REVIEW';
  row[strategyIdx] = result.stage || '';
  row[estimatedCostIdx] = result.estimatedCostUsd == null ? '' : String(result.estimatedCostUsd);

  if (result.status === 'matched') matched++;
  else if (result.status === 'error') errors++;
  else noMatch++;
}

async function worker() {
  while (cursor < work.length) {
    const item = work[cursor++];
    await processItem(item.row, item.rowIndex);
    completed++;
    if (completed % LOG_EVERY === 0 || completed === work.length) {
      writeCSV(OUTPUT, header, rows);
      console.log(
        `Progress ${completed}/${work.length} | matched ${matched} | no match ${noMatch} | errors ${errors} | paid requests ${paidRequests} | est cost $${estimatedCost.toFixed(4)}`,
      );
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, () => worker()));
writeCSV(OUTPUT, header, rows);
saveProgress(progress);

console.log(
  `Done. matched=${matched} no_confident=${noMatch} errors=${errors} paid_requests=${paidRequests} estimated_cost_usd=${estimatedCost.toFixed(4)}`,
);
