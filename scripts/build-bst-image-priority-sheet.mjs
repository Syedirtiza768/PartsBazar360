#!/usr/bin/env node

/**
 * Build a BST-only Superior image priority CSV.
 *
 * The sheet keeps existing image URLs as primary and adds a validated
 * official FEBEST image as secondary when available. It avoids the generic
 * AI web-search output because those URLs were not reliable enough to apply.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);

function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const INPUT = opt('input', 'outputs/superior_all_active_for_ai_images.csv');
const OUTPUT = opt('output', 'outputs/superior_BST_image_priority_sheet.csv');
const LIMIT = Number(opt('limit', '0')) || 0;
const CONCURRENCY = Math.max(1, Number(opt('concurrency', '8')) || 8);
const LOG_EVERY = Math.max(1, Number(opt('log-every', '500')) || 500);

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

function writeCSV(header, objects) {
  return [
    header.map(csvEscape).join(','),
    ...objects.map((obj) => header.map((name) => csvEscape(obj[name] ?? '')).join(',')),
  ].join('\n') + '\n';
}

function headerIndex(header) {
  const idx = {};
  header.forEach((h, i) => {
    idx[h.trim()] = i;
  });
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

function deriveFebest3dUrl(imageUrl) {
  const match = String(imageUrl || '').match(
    /^https:\/\/static\.febest\.de\/images\/(?:big\/)?([^/]+)\/([^/_]+)_p\d+\.jpg(?:$|[?#])/i,
  );
  if (!match) return '';
  const [, folder, imageKey] = match;
  return `https://static.febest.de/3d/${folder}/${imageKey}/41.jpg`;
}

function absoluteFebestUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `https://febest.de${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function extractCatalogDetailUrl(html, partNumber) {
  const escaped = partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowPattern = new RegExp(
    `<tr[\\s\\S]*?<td[^>]*title=["']${escaped}["'][\\s\\S]*?<a\\s+href=["']([^"']+)["']`,
    'i',
  );
  const rowMatch = html.match(rowPattern);
  if (rowMatch) return absoluteFebestUrl(rowMatch[1].replace(/&amp;/g, '&'));

  const fallback = html.match(/<a\s+href=["'](\/en\/details\/[^"']+)["']/i);
  return fallback ? absoluteFebestUrl(fallback[1].replace(/&amp;/g, '&')) : '';
}

function extractDetailImages(html) {
  const urls = [];
  const imageRe = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imageRe.exec(html))) {
    const url = absoluteFebestUrl(match[1].replace(/&amp;/g, '&'));
    if (!/^https:\/\/static\.febest\.de\//i.test(url)) continue;
    if (/\.svg(?:$|[?#])/i.test(url)) continue;
    urls.push(url);
  }

  const reel = html.match(/data-images=["']([^"']+)["']/i);
  if (reel) {
    for (const url of reel[1].split(',')) {
      const clean = absoluteFebestUrl(url.trim().replace(/&amp;/g, '&'));
      if (/^https:\/\/static\.febest\.de\//i.test(clean)) urls.push(clean);
    }
  }

  return [...new Set(urls)].sort((a, b) => {
    const score = (url) => {
      if (/\/images\/big\//i.test(url)) return 0;
      if (/\/3d\//i.test(url)) return 1;
      if (/_p\d+\.jpg/i.test(url)) return 2;
      return 3;
    };
    return score(a) - score(b);
  });
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'PartsBazar360 image enrichment (+https://partsbazar360.com)',
      accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function validateImageUrl(url) {
  if (!url || /\.svg(?:$|[?#])/i.test(url)) return false;

  for (const method of ['HEAD', 'GET']) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'PartsBazar360 image enrichment (+https://partsbazar360.com)',
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });
      clearTimeout(timeout);
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && type.startsWith('image/') && !type.includes('svg')) return true;
      if (method === 'GET') return false;
    } catch {
      if (method === 'GET') return false;
    }
  }

  return false;
}

async function findOfficialFebestImages(partNumber) {
  if (!partNumber) return { detailUrl: '', images: [] };
  const catalogUrl = `https://febest.de/en/catalog?code=${encodeURIComponent(partNumber)}`;
  const catalogHtml = await fetchText(catalogUrl);
  const detailUrl = extractCatalogDetailUrl(catalogHtml, partNumber);
  if (!detailUrl) return { detailUrl: catalogUrl, images: [] };
  const detailHtml = await fetchText(detailUrl);
  return { detailUrl, images: extractDetailImages(detailHtml) };
}

function mapOutput(row, idx) {
  const currentUrls = splitUrls(cell(row, idx, 'current_image_urls'));
  const primary = currentUrls[0] || '';
  const additional = currentUrls.slice(1).join('|');

  return {
    listing_id: cell(row, idx, 'listing_id'),
    canonical_part_id: cell(row, idx, 'canonical_part_id'),
    seller_name: cell(row, idx, 'seller_name'),
    source_tag: cell(row, idx, 'source_tag'),
    title: cell(row, idx, 'title'),
    brand: cell(row, idx, 'brand'),
    manufacturer: cell(row, idx, 'manufacturer'),
    mfr_part_number: cell(row, idx, 'mfr_part_number'),
    genuine_oem_part_number: cell(row, idx, 'genuine_oem_part_number'),
    oe_numbers: cell(row, idx, 'oe_numbers'),
    category: cell(row, idx, 'category'),
    category_group: cell(row, idx, 'category_group'),
    part_type: cell(row, idx, 'part_type'),
    condition: cell(row, idx, 'condition'),
    part_source: cell(row, idx, 'part_source'),
    quality_tier: cell(row, idx, 'quality_tier'),
    price: cell(row, idx, 'price'),
    currency: cell(row, idx, 'currency'),
    seller_sku: cell(row, idx, 'seller_sku'),
    description: cell(row, idx, 'description'),
    item_specifics_json: cell(row, idx, 'item_specifics_json'),
    current_image_urls: currentUrls.join('|'),
    primary_image_url: primary,
    primary_image_role: primary ? 'PRIMARY_EXISTING' : 'PRIMARY_MISSING',
    additional_existing_image_urls: additional,
    secondary_image_url: '',
    secondary_image_role: primary ? 'SECONDARY_FETCHED' : 'PRIMARY_FETCHED_NO_EXISTING_IMAGE',
    secondary_image_source_url: '',
    secondary_image_source: '',
    secondary_image_lookup_status: 'pending',
    secondary_image_review_label: '',
    secondary_image_match_confidence: '',
    secondary_image_match_reason: '',
    final_image_order_preview: primary,
    created_at: cell(row, idx, 'created_at'),
    updated_at: cell(row, idx, 'updated_at'),
  };
}

const OUTPUT_HEADER = [
  'listing_id',
  'canonical_part_id',
  'seller_name',
  'source_tag',
  'title',
  'brand',
  'manufacturer',
  'mfr_part_number',
  'genuine_oem_part_number',
  'oe_numbers',
  'category',
  'category_group',
  'part_type',
  'condition',
  'part_source',
  'quality_tier',
  'price',
  'currency',
  'seller_sku',
  'description',
  'item_specifics_json',
  'current_image_urls',
  'primary_image_url',
  'primary_image_role',
  'additional_existing_image_urls',
  'secondary_image_url',
  'secondary_image_role',
  'secondary_image_source_url',
  'secondary_image_source',
  'secondary_image_lookup_status',
  'secondary_image_review_label',
  'secondary_image_match_confidence',
  'secondary_image_match_reason',
  'final_image_order_preview',
  'created_at',
  'updated_at',
];

const { header, rows } = parseCSV(readFileSync(INPUT, 'utf8'));
const idx = headerIndex(header);
const bstRows = rows.filter((row) => cell(row, idx, 'source_tag') === 'BST');
const selectedRows = LIMIT > 0 ? bstRows.slice(0, LIMIT) : bstRows;
const output = selectedRows.map((row) => mapOutput(row, idx));

let processed = 0;
let matched = 0;
let noMatch = 0;
let errors = 0;
const officialCache = new Map();

async function enrichItem(item) {
  const currentUrls = splitUrls(item.current_image_urls);
  const primary = currentUrls[0] || '';
  const seen = new Set(currentUrls.map((url) => url.toLowerCase()));
  const derived = deriveFebest3dUrl(primary);

  try {
    if (derived && !seen.has(derived.toLowerCase()) && await validateImageUrl(derived)) {
      item.secondary_image_url = derived;
      item.secondary_image_source_url = primary;
      item.secondary_image_source = 'official_febest_static_3d_from_existing_image';
      item.secondary_image_lookup_status = 'matched';
      item.secondary_image_review_label = 'VALIDATED_OFFICIAL_FEBEST_SECONDARY';
      item.secondary_image_match_confidence = '0.98';
      item.secondary_image_match_reason = 'Derived and validated a distinct official FEBEST 3D product image from the existing official FEBEST image key.';
      matched++;
      return;
    }

    const partNumber = item.mfr_part_number;
    let official = officialCache.get(partNumber);
    if (!official) {
      official = await findOfficialFebestImages(partNumber);
      officialCache.set(partNumber, official);
    }

    for (const imageUrl of official.images) {
      if (seen.has(imageUrl.toLowerCase())) continue;
      if (!await validateImageUrl(imageUrl)) continue;

      item.secondary_image_url = imageUrl;
      item.secondary_image_source_url = official.detailUrl;
      item.secondary_image_source = 'official_febest_catalog';
      item.secondary_image_lookup_status = 'matched';
      item.secondary_image_review_label = primary
        ? 'VALIDATED_OFFICIAL_FEBEST_SECONDARY'
        : 'VALIDATED_OFFICIAL_FEBEST_PRIMARY_CANDIDATE';
      item.secondary_image_match_confidence = '0.98';
      item.secondary_image_match_reason = primary
        ? 'Found and validated a distinct official FEBEST image for the exact manufacturer part number; existing image remains primary.'
        : 'Found and validated an official FEBEST image for the exact manufacturer part number; no existing primary image was present.';
      item.final_image_order_preview = [primary, imageUrl, item.additional_existing_image_urls]
        .filter(Boolean)
        .join('|');
      matched++;
      return;
    }

    item.secondary_image_source_url = official.detailUrl || '';
    item.secondary_image_lookup_status = 'no_confident_match';
    item.secondary_image_review_label = primary
      ? 'NO_DISTINCT_VALIDATED_SECONDARY_IMAGE'
      : 'NO_VALIDATED_IMAGE_FOUND';
    item.secondary_image_match_confidence = '0';
    item.secondary_image_match_reason = primary
      ? 'Existing image retained as primary; no distinct official FEBEST secondary image validated.'
      : 'No official FEBEST image URL could be validated for this exact part number.';
    noMatch++;
  } catch (error) {
    item.secondary_image_lookup_status = 'error';
    item.secondary_image_review_label = 'LOOKUP_ERROR';
    item.secondary_image_match_confidence = '0';
    item.secondary_image_match_reason = error instanceof Error ? error.message : String(error);
    errors++;
  } finally {
    if (item.secondary_image_url && !item.final_image_order_preview.includes(item.secondary_image_url)) {
      item.final_image_order_preview = [primary, item.secondary_image_url, item.additional_existing_image_urls]
        .filter(Boolean)
        .join('|');
    }
  }
}

async function worker(workerId, queue) {
  while (queue.length) {
    const item = queue.shift();
    await enrichItem(item);
    processed++;
    if (processed % LOG_EVERY === 0 || processed === output.length) {
      console.log(
        `[${new Date().toISOString()}] processed=${processed}/${output.length} matched=${matched} no_confident=${noMatch} errors=${errors} worker=${workerId}`,
      );
      writeFileSync(OUTPUT, writeCSV(OUTPUT_HEADER, output));
    }
  }
}

console.log(`BST rows selected: ${output.length}`);
console.log(`Writing: ${OUTPUT}`);
console.log(`Concurrency: ${CONCURRENCY}`);

const queue = [...output];
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1, queue)));
writeFileSync(OUTPUT, writeCSV(OUTPUT_HEADER, output));

console.log(`Done. processed=${processed} matched=${matched} no_confident=${noMatch} errors=${errors}`);
