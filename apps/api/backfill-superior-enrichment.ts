import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { OpenSearchService } from './src/modules/search/opensearch.service';

/**
 * Backfill Superior Auto Parts listings with real product images and
 * enrichment data (descriptions, item specifics, fitment hints, etc.).
 *
 * Two CSV sources:
 *   1. Image URLs CSV  — outputs/superior-listings-enriched.csv
 *      Columns: listing_id, ..., imageUrls (pipe-separated), imageLookupStatus
 *   2. Enrichment CSV  — exports/superior_listings_enriched.csv
 *      Columns: listing_id, ..., enriched_title, description, item_specifics_json, ...
 *
 * Usage:
 *   npx ts-node --transpile-only backfill-superior-enrichment.ts
 *   npx ts-node --transpile-only backfill-superior-enrichment.ts --dry-run
 *   npx ts-node --transpile-only backfill-superior-enrichment.ts --limit 100
 */

const IMAGE_CSV =
  process.env.SUPERIOR_IMAGE_CSV ||
  path.resolve(__dirname, '..', 'outputs', 'superior-listings-enriched.csv');
const ENRICHMENT_CSV =
  process.env.SUPERIOR_ENRICHMENT_CSV ||
  path.resolve(__dirname, '..', 'exports', 'superior_listings_enriched.csv');

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const limit =
  limitArg >= 0 ? Math.max(0, Number(process.argv[limitArg + 1] || 0)) : 0;
const chunkSize = 200;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
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
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function headerIndex(headers: string[], name: string): number {
  const idx = headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  return idx;
}

interface ImageRecord {
  imageUrls: string[];
  status: string;
}

interface EnrichmentRecord {
  enrichedTitle: string | null;
  inferredProductType: string | null;
  inferredSystemCategory: string | null;
  fitmentHints: string | null;
  compatibilityNote: string | null;
  itemSpecificsJson: string | null;
  description: string | null;
  detailBullets: string | null;
  searchKeywords: string | null;
}

function loadImageCsv(csvText: string): Map<string, ImageRecord> {
  const [headers, ...rows] = parseCsv(csvText);
  const idIdx = headerIndex(headers, 'listing_id');
  const urlIdx = headerIndex(headers, 'imageurls');
  const statusIdx = headerIndex(headers, 'imagelookupstatus');

  if (idIdx < 0) throw new Error('Image CSV missing listing_id column');
  if (urlIdx < 0) throw new Error('Image CSV missing imageUrls column');

  const map = new Map<string, ImageRecord>();
  for (const row of rows) {
    const id = row[idIdx]?.trim();
    if (!id) continue;
    const rawUrls = row[urlIdx]?.trim() || '';
    const status = row[statusIdx]?.trim() || 'pending';
    const urls = rawUrls
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length > 0) {
      map.set(id, { imageUrls: urls, status });
    }
  }
  return map;
}

function loadEnrichmentCsv(csvText: string): Map<string, EnrichmentRecord> {
  const [headers, ...rows] = parseCsv(csvText);
  const lcHeaders = headers.map((h) => h.trim().toLowerCase());

  const idIdx = lcHeaders.indexOf('listing_id');
  const titleIdx = lcHeaders.indexOf('enriched_title');
  const productTypeIdx = lcHeaders.indexOf('inferred_product_type');
  const systemCatIdx = lcHeaders.indexOf('inferred_system_category');
  const fitmentIdx = lcHeaders.indexOf('fitment_hints');
  const compatIdx = lcHeaders.indexOf('compatibility_note');
  const specificsIdx = lcHeaders.indexOf('item_specifics_json');
  const descIdx = lcHeaders.indexOf('description');
  const bulletsIdx = lcHeaders.indexOf('detail_bullets');
  const keywordsIdx = lcHeaders.indexOf('search_keywords');

  if (idIdx < 0) throw new Error('Enrichment CSV missing listing_id column');

  const map = new Map<string, EnrichmentRecord>();
  for (const row of rows) {
    const id = row[idIdx]?.trim();
    if (!id) continue;
    map.set(id, {
      enrichedTitle: titleIdx >= 0 ? row[titleIdx]?.trim() || null : null,
      inferredProductType:
        productTypeIdx >= 0 ? row[productTypeIdx]?.trim() || null : null,
      inferredSystemCategory:
        systemCatIdx >= 0 ? row[systemCatIdx]?.trim() || null : null,
      fitmentHints: fitmentIdx >= 0 ? row[fitmentIdx]?.trim() || null : null,
      compatibilityNote:
        compatIdx >= 0 ? row[compatIdx]?.trim() || null : null,
      itemSpecificsJson:
        specificsIdx >= 0 ? row[specificsIdx]?.trim() || null : null,
      description: descIdx >= 0 ? row[descIdx]?.trim() || null : null,
      detailBullets:
        bulletsIdx >= 0 ? row[bulletsIdx]?.trim() || null : null,
      searchKeywords:
        keywordsIdx >= 0 ? row[keywordsIdx]?.trim() || null : null,
    });
  }
  return map;
}

function mergeItemSpecifics(
  existing: Record<string, unknown> | null | undefined,
  enrichment: EnrichmentRecord,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing || {}) };

  // Parse the enrichment item_specifics_json (flat object with Title Case keys)
  if (enrichment.itemSpecificsJson) {
    try {
      const parsed = JSON.parse(enrichment.itemSpecificsJson);
      if (parsed && typeof parsed === 'object') {
        // Map Title Case keys to camelCase and merge
        for (const [key, value] of Object.entries(parsed)) {
          if (value == null || value === '') continue;
          const camelKey =
            key.charAt(0).toLowerCase() +
            key
              .slice(1)
              .replace(/ ([A-Z])/g, (_, c) => c.toUpperCase());
          // Don't overwrite existing values with empty ones
          if (!merged[camelKey] || merged[camelKey] === '') {
            merged[camelKey] = value;
          }
        }
      }
    } catch {
      // malformed JSON — skip
    }
  }

  // Store enrichment-specific fields that don't have dedicated columns
  if (enrichment.enrichedTitle && !merged.enrichedTitle) {
    merged.enrichedTitle = enrichment.enrichedTitle;
  }
  if (enrichment.inferredProductType) {
    merged.inferredProductType = enrichment.inferredProductType;
  }
  if (enrichment.inferredSystemCategory) {
    merged.inferredSystemCategory = enrichment.inferredSystemCategory;
  }
  if (enrichment.fitmentHints) {
    merged.fitmentHints = enrichment.fitmentHints;
  }
  if (enrichment.compatibilityNote) {
    merged.compatibilityNote = enrichment.compatibilityNote;
  }
  if (enrichment.detailBullets) {
    merged.detailBullets = enrichment.detailBullets;
  }
  if (enrichment.searchKeywords) {
    merged.searchKeywords = enrichment.searchKeywords;
  }

  return merged;
}

async function main() {
  console.log('=== Superior Auto Parts Enrichment Backfill ===');
  console.log(`Image CSV:       ${IMAGE_CSV}`);
  console.log(`Enrichment CSV:  ${ENRICHMENT_CSV}`);
  console.log(`Mode:            ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (limit) console.log(`Limit:           ${limit} parts`);
  console.log();

  // Load CSVs
  const imageText = await fs.readFile(IMAGE_CSV, 'utf8');
  const imageData = loadImageCsv(imageText);
  console.log(`Loaded ${imageData.size} image records (matched status)`);

  const enrichmentText = await fs.readFile(ENRICHMENT_CSV, 'utf8');
  const enrichmentData = loadEnrichmentCsv(enrichmentText);
  console.log(`Loaded ${enrichmentData.size} enrichment records`);

  // Collect all unique listing IDs
  const allIds = new Set([...imageData.keys(), ...enrichmentData.keys()]);
  console.log(`Total unique listing IDs: ${allIds.size}`);

  if (dryRun) {
    // Show sample
    const sample = [...allIds].slice(0, 5);
    for (const id of sample) {
      const img = imageData.get(id);
      const enr = enrichmentData.get(id);
      console.log(`\n  ${id}:`);
      if (img) console.log(`    images: ${img.imageUrls.length} URLs (${img.status})`);
      if (enr) {
        console.log(`    title: ${enr.enrichedTitle}`);
        console.log(`    type: ${enr.inferredProductType}`);
        console.log(`    category: ${enr.inferredSystemCategory}`);
        console.log(`    description: ${(enr.description || '').slice(0, 80)}...`);
      }
    }
    console.log('\nDry run complete — no database changes made.');
    return;
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter } as any);
  const searchService = new OpenSearchService();
  searchService.onModuleInit();

  let imagesUpdated = 0;
  let enrichmentUpdated = 0;
  let reindexed = 0;
  let notFound = 0;
  let errors = 0;

  const ids = [...allIds];
  const batch = limit ? ids.slice(0, limit) : ids;

  console.log(`Processing ${batch.length} parts in chunks of ${chunkSize}...\n`);

  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);

    // Fetch all CanonicalParts in this chunk
    const parts = await prisma.canonicalPart.findMany({
      where: { id: { in: chunk } },
      include: { fitments: true, offers: { include: { seller: true } } },
    });

    const foundIds = new Set(parts.map((p) => p.id));

    for (const id of chunk) {
      if (!foundIds.has(id)) {
        notFound++;
        continue;
      }

      const part = parts.find((p) => p.id === id)!;
      const img = imageData.get(id);
      const enr = enrichmentData.get(id);

      const updateData: Record<string, unknown> = {};
      let needsUpdate = false;

      // Images: only update if the part currently has no real images
      // (has placeholder SVGs or empty array)
      if (img && img.imageUrls.length > 0) {
        const currentUrls = part.imageUrls || [];
        const hasRealImages = currentUrls.some(
          (u) =>
            u.startsWith('http://') || u.startsWith('https://'),
        );
        if (!hasRealImages) {
          updateData.imageUrls = img.imageUrls;
          needsUpdate = true;
          imagesUpdated++;
        }
      }

      // Enrichment: description + itemSpecifics
      if (enr) {
        // Description: update if empty
        if (enr.description && (!part.description || part.description.trim() === '')) {
          updateData.description = enr.description;
          needsUpdate = true;
        }

        // Item specifics: merge enrichment data with existing
        const existingIs = (part.itemSpecifics as Record<string, unknown>) || null;
        const merged = mergeItemSpecifics(existingIs, enr);
        if (JSON.stringify(merged) !== JSON.stringify(existingIs)) {
          updateData.itemSpecifics = merged;
          needsUpdate = true;
        }

        // Category: update if enrichment provides a more specific one
        if (enr.inferredSystemCategory && (!part.category || part.category === 'General')) {
          updateData.category = enr.inferredSystemCategory;
          needsUpdate = true;
        }

        // Category group: use inferred product type (e.g. "Thermostat", "Brake Disc")
        if (enr.inferredProductType && (!part.categoryGroup || part.categoryGroup === '')) {
          updateData.categoryGroup = enr.inferredProductType;
          needsUpdate = true;
        }

        enrichmentUpdated++;
      }

      if (!needsUpdate) continue;

      try {
        await prisma.canonicalPart.update({
          where: { id },
          data: updateData as any,
        });

        // Reindex in OpenSearch
        const updatedPart = await prisma.canonicalPart.findUnique({
          where: { id },
          include: { fitments: true, offers: { include: { seller: true } } },
        });

        if (updatedPart) {
          await searchService.indexPart({
            id: updatedPart.id,
            title: updatedPart.title,
            brand: updatedPart.brand,
            manufacturerPartNumber: updatedPart.manufacturerPartNumber,
            category: updatedPart.category,
            categoryGroup: updatedPart.categoryGroup,
            partType: updatedPart.partType,
            oeNumbers: updatedPart.oeNumbers,
            imageUrls: updatedPart.imageUrls,
            partSource: updatedPart.partSource,
            qualityTier: updatedPart.qualityTier,
            fitmentStatus: updatedPart.fitmentStatus,
            fitmentConfidence: updatedPart.fitmentConfidence,
            createdAt: updatedPart.createdAt,
            fitments: updatedPart.fitments,
            offers: updatedPart.offers,
            compatibility: updatedPart.compatibility,
          });
          reindexed++;
        }
      } catch (err) {
        errors++;
        if (errors <= 10) {
          console.error(`  Error updating ${id}:`, (err as Error).message);
        }
      }
    }

    const processed = Math.min(i + chunkSize, batch.length);
    console.log(
      `  Progress: ${processed}/${batch.length} | images: ${imagesUpdated} | enrichment: ${enrichmentUpdated} | reindexed: ${reindexed} | not found: ${notFound} | errors: ${errors}`,
    );
  }

  console.log(`\n=== Complete ===`);
  console.log(`  Images updated:      ${imagesUpdated}`);
  console.log(`  Enrichment updated:  ${enrichmentUpdated}`);
  console.log(`  Reindexed in OS:     ${reindexed}`);
  console.log(`  Not found in DB:     ${notFound}`);
  console.log(`  Errors:              ${errors}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
