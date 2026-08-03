#!/usr/bin/env node
/**
 * Apply the granular-category classification export back onto the DB.
 *
 * The CSV (active_listings_export_granular_categories.csv) is the FINAL
 * keep-list of SellerOffers that should remain ACTIVE, each carrying the
 * resolved category/category_group for its CanonicalPart. Everything else
 * that is currently ACTIVE fell out somewhere upstream (non-English title,
 * SAL/BLK dedup, etc.) and should be removed:
 *
 *   - hard-DELETE the offer if it has zero OrderItem/CartItem/SalvageUnit
 *     references (real transaction/history signals). Inventory rows are
 *     NOT a blocker — they're a 1:1 stock-bookkeeping row created for
 *     essentially every offer at ingestion regardless of sales activity
 *     (220,806 Inventory rows for 220,805 offers, vs. 6 OrderItems / 20
 *     CartItems / 0 SalvageUnits total in the DB) — so its own Inventory
 *     row(s) are deleted alongside the offer. The optional SourceRecord/
 *     SellerUploadRow/SupportTicket FKs are detached first; OfferPrice
 *     cascades.
 *   - otherwise (it has real order/cart/salvage history) just set
 *     status = INACTIVE, matching the pattern used elsewhere in
 *     scripts/deactivate-nonenglish-offers.mjs and dedup-sal-blk-offers.mjs
 *
 * For every offer that IS in the keep-list, category/categoryGroup from the
 * CSV is written onto its CanonicalPart (grouped by canonicalPartId; if
 * sibling offers for the same part disagree in the CSV, first-wins and the
 * conflict is logged for review).
 *
 * Usage (inside API container / standalone container on the app network):
 *   node scripts/apply-granular-categories.mjs /path/to/categories.csv
 *   CONFIRM=1 node scripts/apply-granular-categories.mjs /path/to/categories.csv
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const CONFIRM = process.env.CONFIRM === '1';
const CSV_PATH = process.argv[2];
const BATCH = 500;

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function readCsv(path) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let header = null;
  const rows = [];
  for await (const line of rl) {
    if (!line) continue;
    const fields = parseCsvLine(line);
    if (!header) {
      header = fields;
      continue;
    }
    const row = {};
    header.forEach((h, i) => { row[h] = fields[i]; });
    rows.push(row);
  }
  return rows;
}

async function distinctIdsBlockingDelete(prisma, slice) {
  const [orderItems, cartItems, salvage] = await Promise.all([
    prisma.orderItem.findMany({ where: { sellerOfferId: { in: slice } }, select: { sellerOfferId: true }, distinct: ['sellerOfferId'] }),
    prisma.cartItem.findMany({ where: { sellerOfferId: { in: slice } }, select: { sellerOfferId: true }, distinct: ['sellerOfferId'] }),
    prisma.salvageUnit.findMany({ where: { sellerOfferId: { in: slice } }, select: { sellerOfferId: true }, distinct: ['sellerOfferId'] }),
  ]);
  return new Set([
    ...orderItems.map((x) => x.sellerOfferId),
    ...cartItems.map((x) => x.sellerOfferId),
    ...salvage.map((x) => x.sellerOfferId),
  ]);
}

async function main() {
  if (!CSV_PATH) throw new Error('Usage: node apply-granular-categories.mjs <csv-path>');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  console.log(`Reading ${CSV_PATH} ...`);
  const rows = await readCsv(CSV_PATH);
  console.log(`Parsed ${rows.length} CSV rows`);

  const keepMap = new Map(); // listing_id -> { category, categoryGroup }
  for (const r of rows) {
    if (!r.listing_id) continue;
    keepMap.set(r.listing_id, {
      category: r.category || null,
      categoryGroup: r.category_group || null,
    });
  }
  console.log(`Keep-list size: ${keepMap.size}`);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const activeOffers = await prisma.sellerOffer.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, canonicalPartId: true },
    });
    console.log(`Active offers in DB: ${activeOffers.length}`);

    const offListIds = activeOffers.filter((o) => !keepMap.has(o.id)).map((o) => o.id);
    console.log(`Off-list (not in CSV, to remove): ${offListIds.length}`);

    const deleteEligible = [];
    const mustDeactivate = [];
    for (let i = 0; i < offListIds.length; i += BATCH) {
      const slice = offListIds.slice(i, i + BATCH);
      const blocked = await distinctIdsBlockingDelete(prisma, slice);
      for (const id of slice) {
        if (blocked.has(id)) mustDeactivate.push(id);
        else deleteEligible.push(id);
      }
      console.log(`  ... scanned ${Math.min(i + BATCH, offListIds.length)}/${offListIds.length}`);
    }
    console.log(`Hard-delete eligible: ${deleteEligible.length}`);
    console.log(`Must deactivate (has order/cart/inventory/salvage history): ${mustDeactivate.length}`);

    const keptOffers = activeOffers.filter((o) => keepMap.has(o.id));
    const partUpdates = new Map(); // canonicalPartId -> { category, categoryGroup, conflict }
    for (const o of keptOffers) {
      const csvRow = keepMap.get(o.id);
      const existing = partUpdates.get(o.canonicalPartId);
      if (!existing) {
        partUpdates.set(o.canonicalPartId, { ...csvRow, conflict: false });
      } else if (existing.category !== csvRow.category || existing.categoryGroup !== csvRow.categoryGroup) {
        existing.conflict = true;
      }
    }
    const conflicts = [...partUpdates.entries()].filter(([, v]) => v.conflict);
    console.log(`Parts to update: ${partUpdates.size} (conflicting sibling rows: ${conflicts.length})`);
    if (conflicts.length) {
      console.log('Sample conflicting canonicalPartIds (first-wins used):', conflicts.slice(0, 10).map(([id]) => id));
    }

    if (!CONFIRM) {
      console.log('\nDRY RUN — set CONFIRM=1 to apply. Nothing was changed.');
      return;
    }

    let hardDeleted = 0;
    for (let i = 0; i < deleteEligible.length; i += BATCH) {
      const slice = deleteEligible.slice(i, i + BATCH);
      await prisma.$transaction([
        prisma.sourceRecord.updateMany({ where: { sellerOfferId: { in: slice } }, data: { sellerOfferId: null } }),
        prisma.sellerUploadRow.updateMany({ where: { sellerOfferId: { in: slice } }, data: { sellerOfferId: null } }),
        prisma.supportTicket.updateMany({ where: { sellerOfferId: { in: slice } }, data: { sellerOfferId: null } }),
        prisma.inventory.deleteMany({ where: { offerId: { in: slice } } }),
        prisma.sellerOffer.deleteMany({ where: { id: { in: slice } } }),
      ]);
      hardDeleted += slice.length;
      console.log(`  deleted ${Math.min(i + BATCH, deleteEligible.length)}/${deleteEligible.length}`);
    }

    let deactivated = 0;
    for (let i = 0; i < mustDeactivate.length; i += BATCH) {
      const slice = mustDeactivate.slice(i, i + BATCH);
      await prisma.sellerOffer.updateMany({ where: { id: { in: slice } }, data: { status: 'INACTIVE' } });
      deactivated += slice.length;
      console.log(`  deactivated ${Math.min(i + BATCH, mustDeactivate.length)}/${mustDeactivate.length}`);
    }

    let categoryUpdated = 0;
    const partIds = [...partUpdates.keys()];
    for (let i = 0; i < partIds.length; i += BATCH) {
      const slice = partIds.slice(i, i + BATCH);
      await Promise.all(slice.map((id) => {
        const v = partUpdates.get(id);
        return prisma.canonicalPart.update({
          where: { id },
          data: { category: v.category, categoryGroup: v.categoryGroup },
        });
      }));
      categoryUpdated += slice.length;
      console.log(`  category-updated ${Math.min(i + BATCH, partIds.length)}/${partIds.length}`);
    }

    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify({
      keepListSize: keepMap.size,
      activeOffersScanned: activeOffers.length,
      hardDeleted,
      deactivated,
      categoryUpdated,
      conflicts: conflicts.length,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
