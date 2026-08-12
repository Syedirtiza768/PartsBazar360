#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const INPUT = process.argv[2] || 'C:\\Users\\Irtaza Hassan\\Downloads\\pending images - Sheet1-ai-enriched.csv';
const OUTPUT = process.argv[3] || INPUT;

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

const LOGO_PATTERNS = [
  /logo/i,
  /header_logo/i,
  /placeholder/i,
  /favicon/i,
  /sprite/i,
  /icon/i,
  /banner/i,
];

function isLogoOrPlaceholder(url) {
  if (!url) return false;
  return LOGO_PATTERNS.some(p => p.test(url));
}

const { header, rows } = parseCSV(readFileSync(INPUT, 'utf8'));
const idx = {};
header.forEach((h, i) => { idx[h.trim()] = i; });

const foundIdx = idx['found_image_url'];
const statusIdx = idx['image_lookup_status'];
const reasonIdx = idx['image_match_reason'];
const reviewIdx = idx['image_review_label'];

let cleaned = 0;

for (const row of rows) {
  const foundUrl = (row[foundIdx] || '').trim();
  if (foundUrl && isLogoOrPlaceholder(foundUrl)) {
    row[foundIdx] = '';
    row[statusIdx] = 'no_confident_match';
    row[reasonIdx] = `Cleaned: image URL was a logo/placeholder (${foundUrl})`;
    row[reviewIdx] = 'NEEDS_MANUAL_IMAGE_REVIEW';
    cleaned++;
  }
}

const lines = [header.map(csvEscape).join(',')];
for (const row of rows) lines.push(header.map((_, i) => csvEscape(row[i] || '')).join(','));
writeFileSync(OUTPUT, lines.join('\n') + '\n', 'utf8');

console.log(`Cleaned ${cleaned} logo/placeholder matches out of ${rows.length} rows`);
console.log(`Output: ${OUTPUT}`);
