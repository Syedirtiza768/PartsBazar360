/**
 * Exports the Superior seller CSV with a pipe-separated `imageUrls` column.
 *
 * FEBEST rows are resolved against the official FEBEST catalog. All other
 * brands use a public image index, but a result is accepted only when its
 * listing/page data contains both the exact normalized part number and make.
 * The checkpoint makes the long-running task safe to stop and resume. It
 * never changes the source CSV or the application DB.
 *
 * Usage:
 *   node apps/api/scripts/export-superior-image-urls.mjs
 *   node apps/api/scripts/export-superior-image-urls.mjs --limit 25
 *
 * An unrelated fallback image is worse than no image for an automotive part
 * listing, so unmatched rows remain blank.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const inputPath = process.env.SUPERIOR_SOURCE_CSV ||
  'C:/Users/Irtaza Hassan/Downloads/Suprior Listings - Sheet1.csv';
const outputPath = process.env.SUPERIOR_ENRICHED_CSV ||
  'outputs/superior-listings-enriched.csv';
const statePath = process.env.SUPERIOR_IMAGE_STATE ||
  'outputs/superior-image-lookup-state.json';
const concurrency = Math.max(1, Number(process.env.SUPERIOR_IMAGE_CONCURRENCY || 4));
const checkpointEvery = Math.max(1, Number(process.env.SUPERIOR_IMAGE_CHECKPOINT_EVERY || 25));
const delayMs = Math.max(0, Number(process.env.SUPERIOR_IMAGE_DELAY_MS || 0));
const brandFilter = (process.env.SUPERIOR_IMAGE_BRAND || '').trim().toUpperCase();
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Math.max(0, Number(process.argv[limitArg + 1] || 0)) : 0;

const BASE = 'https://febest.de';
const userAgent = 'PartsBazar360/1.0 (+https://partsbazar360.com; catalog image export)';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serializeCsv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeImageUrl(value) {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    return url.toString();
  } catch {
    return value.trim();
  }
}

function normalizeToken(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function effectivePartNumber(row, headerIndexes) {
  const raw = row[headerIndexes.mfr_part_number]?.trim() || '';
  if (raw && !/^[+-]?\d+(?:\.\d+)?E[+-]?\d+$/i.test(raw)) return raw;
  const title = row[headerIndexes.title] || '';
  const match = title.match(/[–-]\s*([A-Z0-9][A-Z0-9.\-/]{3,})\s*$/i);
  return match?.[1] || raw;
}

function findDetailsPath(html, code) {
  const slug = code.toLowerCase().replace(/-/g, '_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(`href="(/en/details/[^"]*-${slug})"`, 'i').exec(html);
  if (exact?.[1]) return exact[1];
  const links = [...html.matchAll(/href="(\/en\/details\/[^"]+)"/gi)].map((match) => match[1]);
  return links.find((href) => href.toLowerCase().endsWith(`-${code.toLowerCase().replace(/-/g, '_')}`)) || null;
}

function parseImages(html) {
  const urls = unique(
    [...html.matchAll(/https:\/\/static\.febest\.de\/images\/[^"'>\s]+/gi)]
      .map((match) => normalizeImageUrl(match[0].replaceAll('&amp;', '&'))),
  );
  const big = urls.filter((url) => /\/images\/big\//i.test(url));
  const photos = urls.filter((url) => !/\/images\/big\//i.test(url) && /_p\d+\.(jpg|jpeg|png|webp)$/i.test(url));
  const other = urls.filter((url) => !big.includes(url) && !photos.includes(url) && !/_s\d+\.(png|jpg|jpeg|webp)$/i.test(url));
  return [...big, ...photos, ...other].slice(0, 5);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function lookupFebest(code) {
  const catalog = await fetchText(`${BASE}/en/catalog?code=${encodeURIComponent(code)}`);
  const detailsPath = findDetailsPath(catalog, code);
  if (!detailsPath) return { status: 'not_found', imageUrls: [], sourceUrl: null };
  const sourceUrl = `${BASE}${detailsPath}`;
  const details = await fetchText(sourceUrl);
  const imageUrls = parseImages(details);
  return { status: imageUrls.length ? 'matched' : 'no_images', imageUrls, sourceUrl };
}

async function lookupExactImage(brand, code) {
  const query = `${brand} ${code}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'application/json,text/html,application/xhtml+xml',
  };
  const landing = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });
  if (!landing.ok) throw new Error(`DuckDuckGo landing HTTP ${landing.status}`);
  const landingHtml = await landing.text();
  const token = /vqd=['"]?([^'"&]+)/.exec(landingHtml)?.[1];
  if (!token) throw new Error('DuckDuckGo image token unavailable');
  const response = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(token)}`,
    {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    },
  );
  if (!response.ok) throw new Error(`DuckDuckGo image HTTP ${response.status}`);
  const payload = await response.json();
  const candidates = Array.isArray(payload?.results) ? payload.results : [];
  const normalizedBrand = normalizeToken(brand);
  const normalizedCode = normalizeToken(code);
  const match = candidates.find((candidate) => {
    const evidence = normalizeToken(`${candidate.title || ''} ${candidate.url || ''}`);
    return Boolean(candidate.image) && evidence.includes(normalizedBrand) && evidence.includes(normalizedCode);
  });
  return match
    ? {
        status: 'matched',
        imageUrls: [normalizeImageUrl(match.image)],
        sourceUrl: match.url,
        source: match.source || 'DuckDuckGo image index',
      }
    : { status: 'not_found', imageUrls: [], sourceUrl: null, source: null };
}

/*
 * DuckDuckGo returns result objects containing the direct image URL, product
 * page and result title. We retain that source URL in the exported CSV so the
 * exact make/part-number evidence can be audited later.
 */
async function loadState() {
  try {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    return state && typeof state === 'object' && state.lookups
      ? { ...state, exactLookups: state.exactLookups || {} }
      : { lookups: {}, exactLookups: {} };
  } catch {
    return { lookups: {}, exactLookups: {} };
  }
}

async function writeOutput(headers, rows, headerIndexes, lookups) {
  const imageIndex = headers.length;
  const sourceIndex = headers.length + 1;
  const statusIndex = headers.length + 2;
  const enriched = [
    [...headers, 'imageUrls', 'imageSourceUrl', 'imageLookupStatus'],
    ...rows.map((row) => {
      const partNumber = effectivePartNumber(row, headerIndexes);
      const brand = row[headerIndexes.brand]?.trim().toUpperCase() || '';
      const lookup = brand === 'FEBEST' && partNumber
        ? lookups[partNumber]
        : lookups[`${brand}|${partNumber}`];
      const result = [...row];
      result[imageIndex] = lookup?.imageUrls?.join('|') || '';
      result[sourceIndex] = lookup?.sourceUrl || '';
      result[statusIndex] = lookup?.status || 'pending';
      return result;
    }),
  ];
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.partial`;
  await fs.writeFile(temporary, serializeCsv(enriched), 'utf8');
  await fs.rename(temporary, outputPath);
}

async function saveProgress(headers, rows, headerIndexes, state) {
  state.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  await writeOutput(headers, rows, headerIndexes, { ...state.lookups, ...state.exactLookups });
}

const raw = await fs.readFile(inputPath, 'utf8');
const [headers, ...rows] = parseCsv(raw);
const headerIndexes = Object.fromEntries(headers.map((header, index) => [header.trim().toLowerCase(), index]));
for (const field of ['brand', 'mfr_part_number']) {
  if (headerIndexes[field] === undefined) throw new Error(`Missing required column: ${field}`);
}

const state = await loadState();
const targets = unique(rows
  .map((row) => {
    const brand = row[headerIndexes.brand]?.trim().toUpperCase() || '';
    const code = effectivePartNumber(row, headerIndexes);
    return brand && code && (!brandFilter || brand === brandFilter) ? `${brand}|${code}` : '';
  }));
const queue = targets.filter((target) => {
  const [brand, code] = target.split('|');
  const existing = brand === 'FEBEST' ? state.lookups[code] : state.exactLookups[target];
  return !existing || (existing.status === 'error' && (existing.attempts || 1) < 3);
}).slice(0, limit || undefined);

console.log(JSON.stringify({ event: 'start', totalRows: rows.length, uniqueTargets: targets.length, queued: queue.length, concurrency, delayMs, brandFilter: brandFilter || null, outputPath }));

let cursor = 0;
let completed = 0;
async function worker() {
  while (cursor < queue.length) {
    const target = queue[cursor++];
    const [brand, code] = target.split('|');
    try {
      const result = brand === 'FEBEST'
        ? await lookupFebest(code)
        : await lookupExactImage(brand, code);
      const key = brand === 'FEBEST' ? code : target;
      const collection = brand === 'FEBEST' ? state.lookups : state.exactLookups;
      collection[key] = { ...result, checkedAt: new Date().toISOString() };
    } catch (error) {
      const key = brand === 'FEBEST' ? code : target;
      const collection = brand === 'FEBEST' ? state.lookups : state.exactLookups;
      const previous = collection[key];
      collection[key] = {
        status: 'error',
        imageUrls: [],
        sourceUrl: null,
        error: String(error.message || error),
        attempts: (previous?.attempts || 0) + 1,
        checkedAt: new Date().toISOString(),
      };
    }
    if (delayMs > 0) await sleep(delayMs);
    completed += 1;
    if (completed % checkpointEvery === 0 || completed === queue.length) {
      await saveProgress(headers, rows, headerIndexes, state);
      const values = [...Object.values(state.lookups), ...Object.values(state.exactLookups)];
      console.log(JSON.stringify({ event: 'progress', completed, queued: queue.length, matched: values.filter((item) => item.status === 'matched').length, errors: values.filter((item) => item.status === 'error').length }));
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
if (queue.length === 0) await saveProgress(headers, rows, headerIndexes, state);
console.log(JSON.stringify({ event: 'done', outputPath, lookupCount: Object.keys(state.lookups).length + Object.keys(state.exactLookups).length }));
