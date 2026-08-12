#!/usr/bin/env node

/**
 * Validates found_image_url values in an enrichment CSV.
 *
 * Rows with image_lookup_status=matched only remain matched when the URL
 * returns a non-SVG image content type. Invalid URLs are relabeled so the DB
 * apply script will ignore them.
 */

import fs from 'node:fs';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const INPUT = opt('input', '');
const OUTPUT = opt('output', INPUT.replace(/\.csv$/i, '-validated.csv'));
const LIMIT = Number(opt('limit', '0')) || 0;
const CONCURRENCY = Math.max(1, Number(opt('concurrency', '8')) || 8);

if (!INPUT) {
  console.error('Provide --input path.csv');
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
      } else if (ch === '"') quoted = false;
      else value += ch;
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
    } else value += ch;
  }
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return { header: rows.shift() || [], rows };
}

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ensureColumn(header, rows, name) {
  let idx = header.indexOf(name);
  if (idx >= 0) return idx;
  idx = header.length;
  header.push(name);
  for (const row of rows) row[idx] = '';
  return idx;
}

function writeCsv(path, header, rows) {
  fs.writeFileSync(
    path,
    [header.map(csvEscape).join(','), ...rows.map((row) => header.map((_, i) => csvEscape(row[i] || '')).join(','))].join('\n'),
    'utf8',
  );
}

function isSvgLikeUrl(url) {
  return /\.svg(?:[?#].*)?$/i.test(String(url || '')) ||
    /\/(?:placeholder|infographic)\.svg(?:[?#].*)?$/i.test(String(url || ''));
}

async function validateImageUrl(url) {
  const target = String(url || '').trim();
  if (!target || isSvgLikeUrl(target)) return { ok: false, reason: 'empty or SVG URL' };
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(target, {
        method,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; PartsBazar360ImageLookup/1.0; +https://partsbazar360.com)',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          ...(method === 'GET' ? { Range: 'bytes=0-2047' } : {}),
        },
        redirect: 'follow',
      });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && contentType.startsWith('image/') && !contentType.includes('svg')) {
        return { ok: true, reason: `${res.status} ${contentType}` };
      }
      if (method === 'GET') {
        return { ok: false, reason: `HTTP ${res.status}; content-type ${contentType || 'unknown'}` };
      }
    } catch (err) {
      if (method === 'GET') return { ok: false, reason: err.message || String(err) };
    }
  }
  return { ok: false, reason: 'not a valid raster image response' };
}

async function main() {
  const { header, rows } = parseCSV(fs.readFileSync(INPUT, 'utf8'));
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const statusIdx = idx.image_lookup_status;
  const imageIdx = idx.found_image_url;
  const reasonIdx = ensureColumn(header, rows, 'image_match_reason');
  const reviewIdx = ensureColumn(header, rows, 'image_review_label');
  const validationIdx = ensureColumn(header, rows, 'image_url_validation');

  if (statusIdx == null || imageIdx == null) throw new Error('CSV missing image_lookup_status or found_image_url');

  const matchedRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => row[statusIdx] === 'matched' && String(row[imageIdx] || '').trim());
  const work = LIMIT ? matchedRows.slice(0, LIMIT) : matchedRows;

  let cursor = 0;
  let valid = 0;
  let invalid = 0;

  async function worker() {
    while (cursor < work.length) {
      const { row } = work[cursor++];
      const result = await validateImageUrl(row[imageIdx]);
      row[validationIdx] = result.ok ? `valid: ${result.reason}` : `invalid: ${result.reason}`;
      if (result.ok) {
        valid++;
      } else {
        invalid++;
        row[statusIdx] = 'no_confident_match';
        row[reviewIdx] = 'IMAGE_URL_UNREACHABLE';
        row[reasonIdx] = `${row[reasonIdx] || ''} Image URL failed validation: ${result.reason}`.trim();
      }
      const done = valid + invalid;
      if (done % 100 === 0 || done === work.length) {
        writeCsv(OUTPUT, header, rows);
        console.log(`Validated ${done}/${work.length} | valid ${valid} | invalid ${invalid}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, () => worker()));
  writeCsv(OUTPUT, header, rows);
  console.log(`Done. Wrote ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
