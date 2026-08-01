#!/usr/bin/env node
/**
 * Wipe OpenSearch canonical_parts and rebuild ONLY from Postgres parts that
 * currently have at least one ACTIVE SellerOffer from an ACTIVE seller.
 *
 * Why: browse/search reads OpenSearch, not live Postgres. Deletes/inactivations
 * never remove OS docs, so the site can show hundreds of thousands of ghosts.
 *
 * Usage (inside API container):
 *   node /tmp/reindex-active-from-db.mjs
 *   DRY_RUN=1 node /tmp/reindex-active-from-db.mjs
 *   SKIP_DELETE=1 node /tmp/reindex-active-from-db.mjs   # upsert only, no wipe
 *
 * Env:
 *   DATABASE_URL, OPENSEARCH_URL (defaults to http://opensearch:9200)
 *   INDEX (default canonical_parts)
 *   BATCH (default 200)
 *   LIMIT (0 = all)
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const OS = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
const INDEX = process.env.INDEX || 'canonical_parts';
const BATCH = Math.max(50, Number(process.env.BATCH || 200));
const LIMIT = Number(process.env.LIMIT || 0);
const DRY_RUN = process.env.DRY_RUN === '1';
const SKIP_DELETE = process.env.SKIP_DELETE === '1';

function normalizePartNumber(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Mirror of apps/api/src/modules/search/identifier-sanitize.util.ts — kept in
 * sync by hand because this script runs as plain ESM inside the API container
 * and cannot import the compiled TS. See that file for why this matters:
 * manufacturerPartNumber^3 and oeNumbers^2 are the highest-boosted fields, and
 * the feeds write part-name words ("BUMPER", "AUDI") into them.
 */
function isIndexableIdentifier(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 3 && /\d/.test(trimmed);
}

function sanitizeIdentifier(value) {
  return isIndexableIdentifier(value) ? value.trim() : null;
}

function sanitizeIdentifierList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const clean = sanitizeIdentifier(raw);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

async function os(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${OS}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

/**
 * Mirror of applySuperiorPriority in
 * apps/api/src/modules/search/buyer-visible-offers.util.ts — kept in sync by
 * hand for the same reason as sanitizeIdentifier above. When a part has a
 * Superior offer, its Blackline/Salvage offers are not buyer-visible, so they
 * must not set minPrice or sourceTags either.
 */
const SUPERIOR_SELLER_ID = 'seller-superior-auto-parts';
const SUPERFLOUS_SELLER_IDS = new Set([
  'seller-blackline-auto-parts',
  'seller-salvage-auto-parts',
]);

function applySuperiorPriority(offers) {
  if (!offers.some((o) => o.sellerId === SUPERIOR_SELLER_ID)) return offers;
  return offers.filter((o) => !SUPERFLOUS_SELLER_IDS.has(o.sellerId ?? ''));
}

function toDoc(part) {
  const activeOffers = applySuperiorPriority(
    (part.offers || []).filter(
      (o) => o.status === 'ACTIVE' && o.seller?.onboardingStatus === 'ACTIVE',
    ),
  );
  const partNumbers = part.partNumbers || [];
  const minPrice =
    activeOffers.length > 0
      ? Math.min(...activeOffers.map((o) => o.price ?? Infinity))
      : null;

  return {
    id: part.id,
    title: part.title,
    partType: part.partType || null,
    brand: part.brand,
    manufacturerPartNumber: sanitizeIdentifier(part.manufacturerPartNumber),
    partNumbers,
    normalizedPartNumbers: partNumbers
      .filter((n) => n.numberType !== 'OEM_CROSS_REFERENCE')
      .map((n) => n.normalizedNumber)
      .filter(Boolean),
    category: part.category,
    makes: [...new Set(
      [
        ...(Array.isArray(part.compatibility) ? part.compatibility.map((c) => c.make).filter(Boolean) : []),
        ...(part.fitments || [])
          .map((f) => f.vehicleConfig?.generation?.model?.make?.name)
          .filter(Boolean),
      ],
    )],
    oeNumbers: sanitizeIdentifierList(part.oeNumbers),
    interchangePartNumbers: partNumbers
      .filter((n) => n.numberType === 'OEM_CROSS_REFERENCE')
      .map((n) => n.normalizedNumber)
      .filter(Boolean),
    imageUrls: part.imageUrls || [],
    listingUrl: part.listingUrl || null,
    ebayItemId: part.ebayItemId || null,
    // Do NOT index raw compatibility JSON: dynamic mapping breaks when
    // fields like year mix numbers and "-" strings (mapper_parsing_exception).
    // PDP reads compatibility from Postgres; search uses fitments[].
    partSource: part.partSource || null,
    qualityTier: part.qualityTier || null,
    fitmentStatus: part.fitmentStatus || null,
    fitmentConfidence: part.fitmentConfidence ?? null,
    createdAt: part.createdAt?.toISOString?.() || part.createdAt || new Date().toISOString(),
    minPrice: Number.isFinite(minPrice) ? minPrice : null,
    fitments: (part.fitments || [])
      .filter((f) => ['A', 'B'].includes(f.evidenceLevel) && Number(f.confidence) >= 0.8)
      .map((f) => f.vehicleConfigId),
    offers: activeOffers.map((o) => ({
      id: o.id,
      price: o.price,
      currency: o.currency || null,
      condition: o.condition,
      partSource: o.partSource || null,
      qualityTier: o.qualityTier || null,
      sellerId: o.sellerId,
      sellerName: o.seller?.name || null,
      sourceTag: o.sourceTag || null,
    })),
    sourceTags: [...new Set(activeOffers.map((o) => o.sourceTag).filter(Boolean))],
  };
}

async function bulkIndex(docs) {
  if (docs.length === 0) return { indexed: 0, errors: [] };
  const ndjson =
    docs
      .map(
        (doc) =>
          `${JSON.stringify({ index: { _index: INDEX, _id: doc.id } })}\n${JSON.stringify(doc)}`,
      )
      .join('\n') + '\n';
  const res = await os(`/_bulk?refresh=false`, { method: 'POST', body: ndjson });
  const errors = [];
  if (res.errors) {
    for (const item of res.items || []) {
      const r = item.index;
      if (r?.error) errors.push({ id: r._id, error: r.error.type || r.error.reason });
    }
  }
  return { indexed: docs.length - errors.length, errors };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const before = await os(`/${INDEX}/_count`).catch(() => ({ count: 0 }));
    console.log(`OpenSearch before: ${before.count ?? 0} docs in ${INDEX}`);

    const eligiblePartIds = await prisma.sellerOffer.findMany({
      where: {
        status: 'ACTIVE',
        seller: { onboardingStatus: 'ACTIVE' },
      },
      select: { canonicalPartId: true },
      distinct: ['canonicalPartId'],
      ...(LIMIT > 0 ? { take: LIMIT } : {}),
    });

    const partIds = eligiblePartIds.map((r) => r.canonicalPartId);
    console.log(`Postgres parts with ACTIVE offer + ACTIVE seller: ${partIds.length}`);

    if (DRY_RUN) {
      console.log('DRY_RUN=1 — not deleting or indexing.');
      return;
    }

    if (!SKIP_DELETE) {
      // Resolve alias → concrete index (aliases can't be deleted directly)
      let deleteTarget = INDEX;
      try {
        const aliasInfo = await os(`/_alias/${INDEX}`);
        const concreteIndices = Object.keys(aliasInfo);
        if (concreteIndices.length > 0) {
          deleteTarget = concreteIndices[0];
          console.log(`Resolved alias ${INDEX} → concrete index ${deleteTarget}`);
        }
      } catch {}
      console.log(`Deleting index ${deleteTarget}...`);
      await os(`/${deleteTarget}`, { method: 'DELETE' });
      console.log('Index deleted (will auto-create on first bulk index).');
    }

    let indexed = 0;
    let failed = 0;

    for (let i = 0; i < partIds.length; i += BATCH) {
      const slice = partIds.slice(i, i + BATCH);
      const parts = await prisma.canonicalPart.findMany({
        where: { id: { in: slice } },
        include: {
          partNumbers: true,
          fitments: {
            include: {
              vehicleConfig: {
                include: {
                  generation: {
                    include: {
                      model: {
                        include: { make: true },
                      },
                    },
                  },
                },
              },
            },
          },
          offers: {
            where: {
              status: 'ACTIVE',
              seller: { onboardingStatus: 'ACTIVE' },
            },
            include: {
              seller: { select: { id: true, name: true, onboardingStatus: true } },
            },
          },
        },
      });

      const docs = parts.filter((p) => p.offers.length > 0).map(toDoc);
      const result = await bulkIndex(docs);
      indexed += result.indexed;
      failed += result.errors.length;
      if (result.errors.length) {
        console.warn('bulk errors sample:', result.errors.slice(0, 3));
      }
      console.log(
        `... indexed ${Math.min(i + BATCH, partIds.length)}/${partIds.length} (ok=${indexed}, fail=${failed})`,
      );
    }

    await os(`/${INDEX}/_refresh`, { method: 'POST' });
    const after = await os(`/${INDEX}/_count`);
    console.log(`OpenSearch after: ${after.count ?? 0} docs`);
    console.log(`Done. indexed=${indexed} failed=${failed}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
