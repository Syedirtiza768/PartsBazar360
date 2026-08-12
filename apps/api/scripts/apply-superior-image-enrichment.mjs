#!/usr/bin/env node

/**
 * Apply AI image-enrichment CSVs to PartsBazar360 data.
 *
 * - Writes only rows with image_lookup_status=matched and found_image_url.
 * - Leaves no_confident_match rows for review.
 * - Removes SVG URLs from CanonicalPart.imageUrls, ProductMedia, and OpenSearch.
 *
 * Usage:
 *   node scripts/apply-superior-image-enrichment.mjs --csv /tmp/file.csv
 *   node scripts/apply-superior-image-enrichment.mjs --csv a.csv --csv b.csv --dry-run
 *
 * Env:
 *   DATABASE_URL
 *   OPENSEARCH_URL default http://opensearch:9200
 *   OPENSEARCH_INDEX default canonical_parts
 */

import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function values(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1]) out.push(args[i + 1]);
  }
  return out;
}

const CSV_PATHS = values('csv');
const DRY_RUN = flag('dry-run');
const BATCH = Math.max(25, Number(process.env.BATCH || 200));
const OS_INDEX = process.env.OPENSEARCH_INDEX || 'canonical_parts';
const OS_URL = process.env.OPENSEARCH_URL || 'http://opensearch:9200';

if (CSV_PATHS.length === 0) {
  console.error('Provide at least one --csv path.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
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
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  return { header, idx, rows };
}

function cell(row, idx, name) {
  const i = idx[name];
  return i == null ? '' : String(row[i] || '').trim();
}

function isSvgUrl(url) {
  const s = String(url || '').trim();
  return /\.svg(?:[?#].*)?$/i.test(s) || /\/placeholder\.svg(?:[?#].*)?$/i.test(s) || /\/infographic\.svg(?:[?#].*)?$/i.test(s);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    url.hash = '';
    return url.toString();
  } catch {
    return String(value || '').trim();
  }
}

function loadMatchedRows(paths) {
  const byPart = new Map();
  let totalRows = 0;
  let matchedRows = 0;
  let reviewRows = 0;
  let errorRows = 0;

  for (const path of paths) {
    const { idx, rows } = parseCSV(fs.readFileSync(path, 'utf8'));
    for (const row of rows) {
      totalRows++;
      const status = cell(row, idx, 'image_lookup_status');
      if (status === 'no_confident_match') reviewRows++;
      if (status === 'error') errorRows++;
      if (status !== 'matched') continue;

      const canonicalPartId = cell(row, idx, 'canonical_part_id');
      const imageUrl = normalizeUrl(cell(row, idx, 'found_image_url'));
      if (!canonicalPartId || !imageUrl || isSvgUrl(imageUrl)) continue;
      matchedRows++;
      if (!byPart.has(canonicalPartId)) {
        byPart.set(canonicalPartId, {
          canonicalPartId,
          imageUrl,
          sourceUrl: cell(row, idx, 'image_source_url'),
          confidence: cell(row, idx, 'image_match_confidence'),
        });
      }
    }
  }

  return { byPart, totalRows, matchedRows, reviewRows, errorRows };
}

function cleanImageUrls(urls, leadUrl = null) {
  const out = [];
  const push = (url) => {
    const normalized = normalizeUrl(url);
    if (!normalized || isSvgUrl(normalized) || out.includes(normalized)) return;
    out.push(normalized);
  };
  if (leadUrl) push(leadUrl);
  for (const url of urls || []) push(url);
  return out;
}

async function updateOpenSearchImage(client, partId, imageUrls) {
  try {
    await client.update({
      index: OS_INDEX,
      id: partId,
      body: { doc: { imageUrls } },
      refresh: process.env.OPENSEARCH_REFRESH_ON_INDEX === 'true',
    });
    return true;
  } catch (err) {
    if (err?.meta?.statusCode === 404) return false;
    throw err;
  }
}

async function removeSvgFromOpenSearch(client) {
  try {
    const response = await client.updateByQuery({
      index: OS_INDEX,
      conflicts: 'proceed',
      refresh: process.env.OPENSEARCH_REFRESH_ON_INDEX === 'true',
      body: {
        script: {
          lang: 'painless',
          source: `
            if (ctx._source.imageUrls != null) {
              def cleaned = new ArrayList();
              for (def u : ctx._source.imageUrls) {
                if (u != null) {
                  def s = u.toString().toLowerCase();
                  if (!s.endsWith('.svg') && !s.contains('/placeholder.svg') && !s.contains('/infographic.svg')) {
                    cleaned.add(u);
                  }
                }
              }
              ctx._source.imageUrls = cleaned;
            }
          `,
        },
        query: {
          bool: {
            should: [
              { wildcard: { imageUrls: '*.svg' } },
              { wildcard: { imageUrls: '*placeholder.svg*' } },
              { wildcard: { imageUrls: '*infographic.svg*' } },
            ],
            minimum_should_match: 1,
          },
        },
      },
    });
    return response.body?.updated ?? response.body?.total ?? 0;
  } catch (err) {
    console.warn(`OpenSearch SVG cleanup skipped: ${err?.message || err}`);
    return 0;
  }
}

async function main() {
  const { byPart, totalRows, matchedRows, reviewRows, errorRows } = loadMatchedRows(CSV_PATHS);
  console.log(`CSV rows: ${totalRows}`);
  console.log(`Matched rows: ${matchedRows}`);
  console.log(`Unique parts to image: ${byPart.size}`);
  console.log(`Manual review rows: ${reviewRows}`);
  console.log(`CSV error rows: ${errorRows}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
  const os = new OpenSearchClient({ node: OS_URL });

  let partsUpdated = 0;
  let mediaUpserted = 0;
  let osUpdated = 0;
  let svgPartsCleaned = 0;
  let svgMediaDeleted = 0;

  const entries = [...byPart.values()];
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const partIds = chunk.map((x) => x.canonicalPartId);
    const existing = await prisma.canonicalPart.findMany({
      where: { id: { in: partIds } },
      select: { id: true, imageUrls: true },
    });
    const existingById = new Map(existing.map((p) => [p.id, p]));

    for (const item of chunk) {
      const part = existingById.get(item.canonicalPartId);
      if (!part) continue;
      const imageUrls = cleanImageUrls(part.imageUrls, item.imageUrl);
      const changed = JSON.stringify(imageUrls) !== JSON.stringify(part.imageUrls || []);
      if (!DRY_RUN && changed) {
        await prisma.canonicalPart.update({
          where: { id: item.canonicalPartId },
          data: { imageUrls },
        });
      }
      if (changed) partsUpdated++;

      if (!DRY_RUN) {
        await prisma.productMedia.upsert({
          where: {
            canonicalPartId_normalizedUrl: {
              canonicalPartId: item.canonicalPartId,
              normalizedUrl: normalizeUrl(item.imageUrl),
            },
          },
          create: {
            canonicalPartId: item.canonicalPartId,
            url: item.imageUrl,
            normalizedUrl: normalizeUrl(item.imageUrl),
            sourceUrl: item.sourceUrl || null,
            sortOrder: 0,
            isPrimary: true,
            isActualItem: false,
            mediaType: 'IMAGE',
            importStatus: 'AI_MATCHED',
            altText: null,
          },
          update: {
            url: item.imageUrl,
            sourceUrl: item.sourceUrl || null,
            isPrimary: true,
            importStatus: 'AI_MATCHED',
          },
        });
        mediaUpserted++;
        if (await updateOpenSearchImage(os, item.canonicalPartId, imageUrls)) osUpdated++;
      }
    }
    console.log(`Applied ${Math.min(i + BATCH, entries.length)}/${entries.length} unique parts`);
  }

  const svgParts = await prisma.canonicalPart.findMany({
    where: { imageUrls: { isEmpty: false } },
    select: { id: true, imageUrls: true },
  });
  for (const part of svgParts) {
    const cleaned = cleanImageUrls(part.imageUrls);
    if (cleaned.length === (part.imageUrls || []).length) continue;
    svgPartsCleaned++;
    if (!DRY_RUN) {
      await prisma.canonicalPart.update({
        where: { id: part.id },
        data: { imageUrls: cleaned },
      });
      await updateOpenSearchImage(os, part.id, cleaned);
    }
  }

  if (!DRY_RUN) {
    const deleted = await prisma.productMedia.deleteMany({
      where: {
        OR: [
          { url: { endsWith: '.svg', mode: 'insensitive' } },
          { url: { contains: '/placeholder.svg', mode: 'insensitive' } },
          { url: { contains: '/infographic.svg', mode: 'insensitive' } },
          { normalizedUrl: { endsWith: '.svg', mode: 'insensitive' } },
          { normalizedUrl: { contains: '/placeholder.svg', mode: 'insensitive' } },
          { normalizedUrl: { contains: '/infographic.svg', mode: 'insensitive' } },
        ],
      },
    });
    svgMediaDeleted = deleted.count;
    await removeSvgFromOpenSearch(os);
  }

  console.log('Complete.');
  console.log(`Parts imageUrls updated: ${partsUpdated}`);
  console.log(`ProductMedia upserted: ${mediaUpserted}`);
  console.log(`OpenSearch docs updated: ${osUpdated}`);
  console.log(`Parts cleaned of SVG URLs: ${svgPartsCleaned}`);
  console.log(`ProductMedia SVG rows deleted: ${svgMediaDeleted}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
