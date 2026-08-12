#!/usr/bin/env node

/**
 * Analyze the full Superior sheet for image enrichment strategy.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const INPUT = process.argv[2] || 'outputs/superior_all_active_for_ai_images.csv';
const OUTPUT = process.argv[3] || 'outputs/superior_image_strategy_report.md';

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

function idx(header) {
  const out = {};
  header.forEach((h, i) => {
    out[h.trim()] = i;
  });
  return out;
}

function cell(row, index, name) {
  const i = index[name];
  return i == null ? '' : String(row[i] || '').trim();
}

function splitUrls(value) {
  return String(value || '')
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

function usableImageUrls(value) {
  return splitUrls(value).filter((url) => !/\.svg(?:$|[?#])/i.test(url));
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '<invalid>';
  }
}

function compactPart(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function inc(map, key, n = 1) {
  map.set(key, (map.get(key) || 0) + n);
}

function top(map, n = 15) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}

function table(headers, rows) {
  const escape = (v) => String(v ?? '').replace(/\|/g, '\\|');
  return [
    `| ${headers.map(escape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n');
}

const { header, rows } = parseCSV(readFileSync(INPUT, 'utf8'));
const index = idx(header);

const bySource = new Map();
const missingBrands = new Map();
const allBrands = new Map();
const currentDomains = new Map();
const missingBrandBySource = new Map();
const sourceBrandCounts = new Map();
const categoryMissing = new Map();
const sourcePendingParts = new Map();
const domainBySource = new Map();

const existingByBrandPart = new Set();
const existingByPart = new Set();
const existingByOe = new Set();

for (const row of rows) {
  const source = cell(row, index, 'source_tag') || '<blank>';
  const brand = cell(row, index, 'brand') || '<blank>';
  const category = cell(row, index, 'category') || '<blank>';
  const part = compactPart(cell(row, index, 'mfr_part_number'));
  const oeNumbers = cell(row, index, 'oe_numbers').split(/[|,;\s]+/).map(compactPart).filter((v) => v.length >= 4);
  const usable = usableImageUrls(cell(row, index, 'current_image_urls'));
  const hasImage = usable.length > 0;

  if (!bySource.has(source)) {
    bySource.set(source, {
      total: 0,
      withImage: 0,
      missing: 0,
      svgOnly: 0,
      multipleImages: 0,
    });
  }
  const sourceStats = bySource.get(source);
  sourceStats.total++;
  if (hasImage) sourceStats.withImage++;
  else sourceStats.missing++;
  if (!hasImage && splitUrls(cell(row, index, 'current_image_urls')).some((url) => /\.svg(?:$|[?#])/i.test(url))) sourceStats.svgOnly++;
  if (usable.length > 1) sourceStats.multipleImages++;

  inc(allBrands, brand);
  inc(sourceBrandCounts, `${source}|||${brand}`);

  if (hasImage) {
    if (part) {
      existingByPart.add(part);
      existingByBrandPart.add(`${brand.toUpperCase()}|||${part}`);
    }
    for (const oe of oeNumbers) existingByOe.add(oe);
    for (const url of usable) {
      const domain = domainOf(url);
      inc(currentDomains, domain);
      inc(domainBySource, `${source}|||${domain}`);
    }
  } else {
    inc(missingBrands, brand);
    inc(categoryMissing, category);
    inc(missingBrandBySource, `${source}|||${brand}`);
    if (!sourcePendingParts.has(source)) sourcePendingParts.set(source, []);
    if (sourcePendingParts.get(source).length < 30) {
      sourcePendingParts.get(source).push({
        title: cell(row, index, 'title'),
        brand,
        part: cell(row, index, 'mfr_part_number'),
        oe: cell(row, index, 'oe_numbers'),
        category,
      });
    }
  }
}

const internalReuseBySource = new Map();
for (const row of rows) {
  const source = cell(row, index, 'source_tag') || '<blank>';
  const brand = cell(row, index, 'brand') || '<blank>';
  const part = compactPart(cell(row, index, 'mfr_part_number'));
  const oeNumbers = cell(row, index, 'oe_numbers').split(/[|,;\s]+/).map(compactPart).filter((v) => v.length >= 4);
  const hasImage = usableImageUrls(cell(row, index, 'current_image_urls')).length > 0;
  if (hasImage) continue;
  if (!internalReuseBySource.has(source)) {
    internalReuseBySource.set(source, { brandPart: 0, partAnyBrand: 0, oe: 0 });
  }
  const stats = internalReuseBySource.get(source);
  if (part && existingByBrandPart.has(`${brand.toUpperCase()}|||${part}`)) stats.brandPart++;
  if (part && existingByPart.has(part)) stats.partAnyBrand++;
  if (oeNumbers.some((oe) => existingByOe.has(oe))) stats.oe++;
}

const sourceRows = [...bySource.entries()]
  .sort((a, b) => b[1].missing - a[1].missing)
  .map(([source, s]) => [
    source,
    s.total,
    s.withImage,
    s.missing,
    `${((s.missing / s.total) * 100).toFixed(1)}%`,
    s.multipleImages,
  ]);

const internalRows = [...bySource.keys()]
  .sort()
  .map((source) => {
    const stats = internalReuseBySource.get(source) || { brandPart: 0, partAnyBrand: 0, oe: 0 };
    return [source, stats.brandPart, stats.partAnyBrand, stats.oe];
  });

const topBrandRows = top(missingBrands, 25).map(([brand, count]) => [brand, count]);
const topDomainRows = top(currentDomains, 25).map(([domain, count]) => [domain, count]);
const topCategoryRows = top(categoryMissing, 25).map(([category, count]) => [category, count]);

const sourceBrandSections = [...bySource.keys()]
  .sort()
  .map((source) => {
    const brandRows = top(
      new Map([...missingBrandBySource.entries()]
        .filter(([key]) => key.startsWith(`${source}|||`))
        .map(([key, count]) => [key.split('|||')[1], count])),
      10,
    ).map(([brand, count]) => [brand, count]);
    return `### ${source}\n\n${table(['Missing Brand', 'Rows'], brandRows.length ? brandRows : [['<none>', 0]])}`;
  })
  .join('\n\n');

const sourceDomainSections = [...bySource.keys()]
  .sort()
  .map((source) => {
    const domainRows = top(
      new Map([...domainBySource.entries()]
        .filter(([key]) => key.startsWith(`${source}|||`))
        .map(([key, count]) => [key.split('|||')[1], count])),
      10,
    ).map(([domain, count]) => [domain, count]);
    return `### ${source}\n\n${table(['Existing Image Domain', 'Image URL Count'], domainRows.length ? domainRows : [['<none>', 0]])}`;
  })
  .join('\n\n');

const recommendations = [
  ['BST', 'Use official FEBEST catalog/static image extraction. No AI web browsing needed except unresolved leftovers.'],
  ['AAP', 'Use deterministic Partsouq/OEM URL patterns first, then Brave/SerpApi image candidates, then GPT-5.2 fetch only for misses.'],
  ['GEN', 'Likely generic/OEM mix. Run deterministic source-pattern stage first, then cheap image search. Avoid broad AI web search.'],
  ['PSRC', 'Analyze seller/source domain patterns first; likely best handled by deterministic URL/source-specific rules.'],
  ['TNRU', 'Large pending block. Do a 200-row provider pilot with Brave/SerpApi before any GPT fallback.'],
  ['YNTD', 'Largest pending block. Build brand/source-specific rules from current image domains before paid lookup.'],
];

const report = `# Superior Image Strategy Report

Generated: ${new Date().toISOString()}

Input: \`${INPUT}\`

## Summary

- Total Superior active rows: ${rows.length}
- Rows with usable non-SVG image: ${[...bySource.values()].reduce((sum, s) => sum + s.withImage, 0)}
- Rows missing usable image: ${[...bySource.values()].reduce((sum, s) => sum + s.missing, 0)}

## Missing By Source Tag

${table(['Source Tag', 'Total', 'With Image', 'Missing Image', 'Missing %', 'Rows With Multiple Images'], sourceRows)}

## Internal Reuse Opportunity

This checks whether missing rows can reuse an existing image already present elsewhere in the current Superior sheet by exact brand+part, exact part any brand, or OE number.

${table(['Source Tag', 'Exact Brand+Part Hits', 'Exact Part Hits Any Brand', 'OE Hits'], internalRows)}

## Top Missing Brands

${table(['Brand', 'Missing Rows'], topBrandRows)}

## Top Missing Categories

${table(['Category', 'Missing Rows'], topCategoryRows)}

## Existing Image Host Domains

${table(['Domain', 'Image URL Count'], topDomainRows)}

## Source-Specific Missing Brands

${sourceBrandSections}

## Source-Specific Existing Image Domains

${sourceDomainSections}

## Recommended Pipeline

${table(['Source Tag', 'Recommended Strategy'], recommendations)}

## Comprehensive Solution

1. Normalize all current image arrays and remove SVGs from display and stored media.
2. Build a reusable candidate pipeline, not an AI-only pipeline:
   - Free internal exact-match reuse by brand + part number, part number, and OE number.
   - Free deterministic source patterns, starting with official FEBEST and Partsouq-style OEM image URLs.
   - Cheap image-search candidates from Brave or SerpApi, one request per part, validating direct image URLs.
   - AI validation only when candidate scoring is ambiguous.
   - GPT-5.2 web fetch only as the final fallback, preferably in 2-row batches based on the pilot.
3. Accept an image only when:
   - The image URL returns HTTP 2xx with a non-SVG image content type.
   - The candidate text/source URL contains an exact normalized part number or OE number.
   - The result is not a placeholder, logo, no-photo image, or generic vehicle image.
4. Label every row:
   - \`matched\` for validated exact matches.
   - \`no_confident_match\` for uncertain or broken candidates.
   - \`NEEDS_MANUAL_IMAGE_REVIEW\` for rows requiring human review.
5. Apply only \`matched\` rows to local and production.
6. Keep existing images primary unless the listing had no existing image; fetched images become secondary for listings that already had an image.

## Cost Direction

- Current GPT-5.2 + web-fetch one-row pilot: about $0.0595 per processed AAP row.
- 2-row GPT-5.2 batch pilot: about $0.0263 per row and preserved match quality on the tiny sample.
- 3-row and 5-row GPT-5.2 pilots degraded cost/quality.
- Brave image search is the best target low-cost candidate provider: about $5 per 1,000 requests, with image-specific results.
- SerpApi Google Images is more expensive but often stronger for product images: starter pricing is about $25 per 1,000 searches.

`;

writeFileSync(OUTPUT, report, 'utf8');
console.log(`Wrote ${OUTPUT}`);
