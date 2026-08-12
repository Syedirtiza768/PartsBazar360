#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const INPUT = 'C:\\Users\\Irtaza Hassan\\Downloads\\pending images - Sheet1-ai-enriched.csv';

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') { quoted = false; }
      else { value += ch; }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(value); value = ''; }
    else if (ch === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else { value += ch; }
  }
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }

  const header = rows.shift() || [];
  return { header, rows };
}

const { header, rows } = parseCSV(readFileSync(INPUT, 'utf8'));
const idx = {};
header.forEach((h, i) => { idx[h.trim()] = i; });

const first100 = rows.slice(0, 100);

const matched = first100.filter(r => (r[idx.found_image_url] || '').trim());
const noMatch = first100.filter(r => !(r[idx.found_image_url] || '').trim() && (r[idx.image_lookup_status] || '').trim() === 'no_confident_match');
const errors = first100.filter(r => (r[idx.image_lookup_status] || '').trim() === 'error');

console.log('=== MATCHED PARTS WITH VALID IMAGES (9 total) ===\n');
matched.forEach(r => {
  console.log(`MPN: ${r[idx.mfr_part_number]} | Brand: ${r[idx.brand]} | Title: ${r[idx.title]}`);
  console.log(`  Image: ${r[idx.found_image_url]}`);
  console.log(`  Source: ${r[idx.image_source_url]} | Confidence: ${r[idx.image_match_confidence]}`);
  console.log('');
});

console.log(`\n=== SAMPLE NO-MATCH PARTS (first 15 of ${noMatch.length}) ===\n`);
noMatch.slice(0, 15).forEach(r => {
  const reason = (r[idx.image_match_reason] || '').substring(0, 120);
  console.log(`MPN: ${r[idx.mfr_part_number]} | Brand: ${r[idx.brand]} | Reason: ${reason}`);
});

console.log(`\n=== ERRORS (${errors.length} total) ===\n`);
errors.forEach(r => {
  const reason = (r[idx.image_match_reason] || '').substring(0, 120);
  console.log(`MPN: ${r[idx.mfr_part_number]} | Brand: ${r[idx.brand]} | Error: ${reason}`);
});

console.log(`\n=== SUMMARY ===`);
console.log(`Total rows processed: 100`);
console.log(`Valid product images found: ${matched.length}`);
console.log(`No confident match: ${noMatch.length}`);
console.log(`Errors: ${errors.length}`);
console.log(`Hit rate: ${(matched.length / 100 * 100).toFixed(1)}%`);
