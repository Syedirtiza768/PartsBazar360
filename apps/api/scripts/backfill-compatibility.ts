/**
 * Backfill compatibility on CanonicalPart from stored RawStagingListing.rawPayload
 * using the new normalizeCompatibility that handles compatibleProducts.
 *
 * Run inside the API container:
 *   docker compose exec api npx ts-node scripts/backfill-compatibility.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CompatibilityRow {
  year: number | string;
  make: string;
  model: string;
  trim?: string;
  engine?: string;
  notes?: string;
  source?: string;
}

function normalizeCompatibility(raw: any): CompatibilityRow[] {
  if (!raw) return [];
  const rows: CompatibilityRow[] = [];

  const pushRow = (row: Partial<CompatibilityRow>) => {
    if (!row.make && !row.model && !row.year) return;
    rows.push({
      year: row.year ?? '-',
      make: String(row.make || '-'),
      model: String(row.model || '-'),
      trim: row.trim ? String(row.trim) : '-',
      engine: row.engine ? String(row.engine) : '-',
      notes: row.notes,
      source: row.source || 'ebay',
    });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') continue;
      pushRow({
        year: item.year ?? item.Year ?? item.years ?? item.YearRange,
        make: item.make ?? item.Make ?? item.brand,
        model: item.model ?? item.Model,
        trim: item.trim ?? item.Trim ?? item.submodel ?? item.Submodel,
        engine: item.engine ?? item.Engine,
        notes: item.notes ?? item.Notes ?? item.platform,
        source: 'ebay',
      });
    }
  } else if (typeof raw === 'object') {
    // RealTrack compatibleProducts format
    if (Array.isArray(raw.compatibleProducts)) {
      for (const product of raw.compatibleProducts) {
        const props: Record<string, string> = {};
        for (const prop of product.compatibilityProperties || []) {
          if (prop.name && prop.value) props[prop.name] = prop.value;
        }
        const pf = product.productFamilyProperties || {};
        pushRow({
          year: props.Year || pf.year || '-',
          make: props.Make || pf.make || '-',
          model: props.Model || pf.model || '-',
          trim: props.Trim || pf.trim || '-',
          engine: props.Engine || pf.engine || '-',
          source: 'ebay',
        });
      }
      return dedupe(rows);
    }
    const list = raw.vehicles || raw.items || raw.compatibleVehicles || raw.list;
    if (Array.isArray(list)) return normalizeCompatibility(list);
  }

  return dedupe(rows);
}

function dedupe(rows: CompatibilityRow[]): CompatibilityRow[] {
  const seen = new Set<string>();
  const out: CompatibilityRow[] = [];
  for (const row of rows) {
    const key = `${row.year}|${row.make}|${row.model}|${row.trim}|${row.engine}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => Number(a.year) - Number(b.year));
}

async function main() {
  console.log('Starting compatibility backfill...');

  // Find all raw listings that have compatibleProducts in their rawPayload
  const rawListings = await prisma.rawStagingListing.findMany({
    where: {
      rawPayload: { not: {} },
    },
    select: {
      sourceListingId: true,
      rawPayload: true,
    },
  });

  console.log(`Found ${rawListings.length} raw listings to check`);

  let updated = 0;
  let skipped = 0;

  for (const raw of rawListings) {
    const payload = raw.rawPayload as any;
    const compat = normalizeCompatibility(payload?.compatibility);
    if (compat.length === 0) {
      skipped++;
      continue;
    }

    // Find the CanonicalPart by eBay item ID or listing URL from the raw payload
    const ebayItemId = payload?.ebayItemId;
    const listingUrl = payload?.listingUrl;

    let canonicalPart = null;
    if (ebayItemId) {
      canonicalPart = await prisma.canonicalPart.findFirst({
        where: { ebayItemId },
        select: { id: true },
      });
    }
    if (!canonicalPart && listingUrl) {
      canonicalPart = await prisma.canonicalPart.findFirst({
        where: { listingUrl },
        select: { id: true },
      });
    }
    if (!canonicalPart) {
      // Try matching by title + seller offer
      skipped++;
      continue;
    }

    await prisma.canonicalPart.update({
      where: { id: canonicalPart.id },
      data: { compatibility: compat as any },
    });
    updated++;

    if (updated % 100 === 0) {
      console.log(`Updated ${updated} parts so far...`);
    }
  }

  console.log(`Done. Updated: ${updated}, Skipped: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
