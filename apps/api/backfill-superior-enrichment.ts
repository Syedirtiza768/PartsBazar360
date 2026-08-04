import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { OpenSearchService } from './src/modules/search/opensearch.service';

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
const chunkSize = 100;

function parseCsvLine(line: string): string[] {
  const row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
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
    } else {
      value += ch;
    }
  }
  row.push(value);
  return row;
}

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
  const lcHeaders = headers.map((h) => h.trim().toLowerCase());
  const idIdx = lcHeaders.indexOf('listing_id');
  const urlIdx = lcHeaders.indexOf('imageurls');
  const statusIdx = lcHeaders.indexOf('imagelookupstatus');

  if (idIdx < 0) throw new Error('Image CSV missing listing_id column');
  if (urlIdx < 0) throw new Error('Image CSV missing imageUrls column');

  const map = new Map<string, ImageRecord>();
  for (const row of rows) {
    const id = row[idIdx]?.trim();
    if (!id) continue;
    const rawUrls = row[urlIdx]?.trim() || '';
    const status = statusIdx >= 0 ? row[statusIdx]?.trim() || 'pending' : 'pending';
    const urls = rawUrls.split('|').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) {
      map.set(id, { imageUrls: urls, status });
    }
  }
  return map;
}

async function streamEnrichmentCsv(
  filePath: string,
): Promise<Map<string, EnrichmentRecord>> {
  const map = new Map<string, EnrichmentRecord>();
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  let idIdx = -1;
  let titleIdx = -1;
  let productTypeIdx = -1;
  let systemCatIdx = -1;
  let fitmentIdx = -1;
  let compatIdx = -1;
  let specificsIdx = -1;
  let descIdx = -1;
  let bulletsIdx = -1;
  let keywordsIdx = -1;
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) {
      headers = parseCsvLine(line).map((h) => h.trim().toLowerCase());
      idIdx = headers.indexOf('listing_id');
      titleIdx = headers.indexOf('enriched_title');
      productTypeIdx = headers.indexOf('inferred_product_type');
      systemCatIdx = headers.indexOf('inferred_system_category');
      fitmentIdx = headers.indexOf('fitment_hints');
      compatIdx = headers.indexOf('compatibility_note');
      specificsIdx = headers.indexOf('item_specifics_json');
      descIdx = headers.indexOf('description');
      bulletsIdx = headers.indexOf('detail_bullets');
      keywordsIdx = headers.indexOf('search_keywords');
      if (idIdx < 0) throw new Error('Enrichment CSV missing listing_id column');
      continue;
    }

    const row = parseCsvLine(line);
    const id = row[idIdx]?.trim();
    if (!id) continue;

    map.set(id, {
      enrichedTitle: titleIdx >= 0 ? row[titleIdx]?.trim() || null : null,
      inferredProductType: productTypeIdx >= 0 ? row[productTypeIdx]?.trim() || null : null,
      inferredSystemCategory: systemCatIdx >= 0 ? row[systemCatIdx]?.trim() || null : null,
      fitmentHints: fitmentIdx >= 0 ? row[fitmentIdx]?.trim() || null : null,
      compatibilityNote: compatIdx >= 0 ? row[compatIdx]?.trim() || null : null,
      itemSpecificsJson: specificsIdx >= 0 ? row[specificsIdx]?.trim() || null : null,
      description: descIdx >= 0 ? row[descIdx]?.trim() || null : null,
      detailBullets: bulletsIdx >= 0 ? row[bulletsIdx]?.trim() || null : null,
      searchKeywords: keywordsIdx >= 0 ? row[keywordsIdx]?.trim() || null : null,
    });
  }

  return map;
}

function mergeItemSpecifics(
  existing: Record<string, unknown> | null | undefined,
  enrichment: EnrichmentRecord,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing || {}) };

  if (enrichment.itemSpecificsJson) {
    try {
      const parsed = JSON.parse(enrichment.itemSpecificsJson);
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (value == null || value === '') continue;
          const camelKey =
            key.charAt(0).toLowerCase() +
            key.slice(1).replace(/ ([A-Z])/g, (_: string, c: string) => c.toUpperCase());
          if (!merged[camelKey] || merged[camelKey] === '') {
            merged[camelKey] = value;
          }
        }
      }
    } catch {
      // malformed JSON
    }
  }

  if (enrichment.enrichedTitle && !merged.enrichedTitle) merged.enrichedTitle = enrichment.enrichedTitle;
  if (enrichment.inferredProductType) merged.inferredProductType = enrichment.inferredProductType;
  if (enrichment.inferredSystemCategory) merged.inferredSystemCategory = enrichment.inferredSystemCategory;
  if (enrichment.fitmentHints) merged.fitmentHints = enrichment.fitmentHints;
  if (enrichment.compatibilityNote) merged.compatibilityNote = enrichment.compatibilityNote;
  if (enrichment.detailBullets) merged.detailBullets = enrichment.detailBullets;
  if (enrichment.searchKeywords) merged.searchKeywords = enrichment.searchKeywords;

  return merged;
}

async function main() {
  console.log('=== Superior Auto Parts Enrichment Backfill ===');
  console.log(`Image CSV:       ${IMAGE_CSV}`);
  console.log(`Enrichment CSV:  ${ENRICHMENT_CSV}`);
  console.log(`Mode:            ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (limit) console.log(`Limit:           ${limit} parts`);
  console.log();

  const imageText = await fsp.readFile(IMAGE_CSV, 'utf8');
  const imageData = loadImageCsv(imageText);
  console.log(`Loaded ${imageData.size} image records (matched status)`);

  console.log('Streaming enrichment CSV (this may take a moment)...');
  const enrichmentData = await streamEnrichmentCsv(ENRICHMENT_CSV);
  console.log(`Loaded ${enrichmentData.size} enrichment records`);

  const allIds = new Set([...imageData.keys(), ...enrichmentData.keys()]);
  console.log(`Total unique listing IDs: ${allIds.size}`);

  if (dryRun) {
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
      }
    }
    console.log('\nDry run complete.');
    return;
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter } as any);
  const searchService = new OpenSearchService();
  searchService.onModuleInit();

  // Step 1: Resolve listing_id (SellerOffer.id) → canonicalPartId
  console.log('Resolving SellerOffer → CanonicalPart mapping...');
  const listingIds = [...allIds];
  const offerToPartMap = new Map<string, string>(); // offerId → canonicalPartId

  for (let i = 0; i < listingIds.length; i += 500) {
    const chunk = listingIds.slice(i, i + 500);
    const offers = await prisma.sellerOffer.findMany({
      where: { id: { in: chunk } },
      select: { id: true, canonicalPartId: true },
    });
    for (const offer of offers) {
      offerToPartMap.set(offer.id, offer.canonicalPartId);
    }
    if ((i + 500) % 5000 === 0 || i + 500 >= listingIds.length) {
      console.log(`  Resolved ${Math.min(i + 500, listingIds.length)}/${listingIds.length} offers → ${offerToPartMap.size} parts`);
    }
  }

  // Deduplicate: multiple offers can map to the same CanonicalPart
  const uniquePartIds = [...new Set(offerToPartMap.values())];
  console.log(`Unique CanonicalPart IDs to update: ${uniquePartIds.length}`);

  // Build reverse map: canonicalPartId → all listing_ids (offer IDs) that reference it
  const partToListingIds = new Map<string, string[]>();
  for (const [offerId, partId] of offerToPartMap) {
    if (!partToListingIds.has(partId)) partToListingIds.set(partId, []);
    partToListingIds.get(partId)!.push(offerId);
  }

  let imagesUpdated = 0;
  let enrichmentUpdated = 0;
  let reindexed = 0;
  let notFound = 0;
  let errors = 0;

  const batch = limit ? uniquePartIds.slice(0, Math.ceil(limit * uniquePartIds.length / listingIds.length)) : uniquePartIds;
  console.log(`Processing ${batch.length} parts in chunks of ${chunkSize}...\n`);

  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    const parts = await prisma.canonicalPart.findMany({
      where: { id: { in: chunk } },
      include: { fitments: true, offers: { include: { seller: true } } },
    });
    const foundIds = new Set(parts.map((p) => p.id));

    for (const partId of chunk) {
      if (!foundIds.has(partId)) { notFound++; continue; }

      const part = parts.find((p) => p.id === partId)!;
      // Get all listing_ids (offer IDs) that map to this part, and look up data from CSVs
      const offerIds = partToListingIds.get(partId) || [];
      let img: ImageRecord | undefined;
      let enr: EnrichmentRecord | undefined;
      for (const oid of offerIds) {
        if (!img) img = imageData.get(oid);
        if (!enr) enr = enrichmentData.get(oid);
      }
      const updateData: Record<string, unknown> = {};
      let needsUpdate = false;

      if (img && img.imageUrls.length > 0) {
        const currentUrls = part.imageUrls || [];
        const hasRealImages = currentUrls.some((u) => u.startsWith('http://') || u.startsWith('https://'));
        if (!hasRealImages) {
          updateData.imageUrls = img.imageUrls;
          needsUpdate = true;
          imagesUpdated++;
        }
      }

      if (enr) {
        if (enr.description && (!part.description || part.description.trim() === '')) {
          updateData.description = enr.description;
          needsUpdate = true;
        }
        const existingIs = (part.itemSpecifics as Record<string, unknown>) || null;
        const merged = mergeItemSpecifics(existingIs, enr);
        if (JSON.stringify(merged) !== JSON.stringify(existingIs)) {
          updateData.itemSpecifics = merged;
          needsUpdate = true;
        }
        if (enr.inferredSystemCategory && (!part.category || part.category === 'General')) {
          updateData.category = enr.inferredSystemCategory;
          needsUpdate = true;
        }
        if (enr.inferredProductType && (!part.categoryGroup || part.categoryGroup === '')) {
          updateData.categoryGroup = enr.inferredProductType;
          needsUpdate = true;
        }
        enrichmentUpdated++;
      }

      if (!needsUpdate) continue;

      try {
        await prisma.canonicalPart.update({ where: { id: partId }, data: updateData as any });
        const updatedPart = await prisma.canonicalPart.findUnique({
          where: { id: partId },
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
        if (errors <= 10) console.error(`  Error updating ${partId}:`, (err as Error).message);
      }
    }

    const processed = Math.min(i + chunkSize, batch.length);
    console.log(`  Progress: ${processed}/${batch.length} | images: ${imagesUpdated} | enrichment: ${enrichmentUpdated} | reindexed: ${reindexed} | not found: ${notFound} | errors: ${errors}`);
  }

  console.log(`\n=== Complete ===`);
  console.log(`  Images updated:      ${imagesUpdated}`);
  console.log(`  Enrichment updated:  ${enrichmentUpdated}`);
  console.log(`  Reindexed in OS:     ${reindexed}`);
  console.log(`  Not found in DB:     ${notFound}`);
  console.log(`  Errors:              ${errors}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
