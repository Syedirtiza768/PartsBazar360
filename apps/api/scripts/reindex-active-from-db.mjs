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

// Mirror of catalog-identity.util.ts. The reindexer is plain ESM inside the
// API image, so it cannot import the compiled Nest module directly.
function identityKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '');
}

const CANONICAL_MAKES = [
  'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Buick',
  'BYD', 'Cadillac', 'Chery', 'Chevrolet', 'Chrysler', 'Citroen', 'Dacia',
  'Dodge', 'Ferrari', 'Fiat', 'Ford', 'Geely', 'Genesis', 'GMC', 'Holden',
  'Honda', 'Hummer', 'Hyundai', 'Infiniti', 'Isuzu', 'Jaguar', 'Jeep',
  'Jetour', 'Kia', 'Lamborghini', 'Land Rover', 'Lexus', 'Lincoln', 'Maserati',
  'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'OMODA', 'Opel',
  'Peugeot', 'Porsche', 'Ram', 'Renault', 'Rolls-Royce', 'Saab', 'Scion',
  'Seat', 'Skoda', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Vauxhall',
  'Volkswagen', 'Volvo', 'Zinoro',
];
const MAKE_BY_KEY = new Map(CANONICAL_MAKES.map((name) => [identityKey(name), name]));
for (const [alias, make] of Object.entries({
  BENZ: 'Mercedes-Benz', MERCEDES: 'Mercedes-Benz', MERCEDE: 'Mercedes-Benz',
  MERCEDESBENZ: 'Mercedes-Benz', VW: 'Volkswagen', VOLKSWAGEN: 'Volkswagen',
  VOLKSWAGON: 'Volkswagen', VOLKWAGEN: 'Volkswagen', 'RANGE ROVER': 'Land Rover',
  RANGEROVER: 'Land Rover', LANDROVER: 'Land Rover', 'MINI COOPER': 'Mini',
  MINICOOPER: 'Mini', CADILAC: 'Cadillac', CADLILLAC: 'Cadillac',
  CHEVORLET: 'Chevrolet', CHERVOLET: 'Chevrolet', CHERLOVET: 'Chevrolet',
  CHEORLET: 'Chevrolet', INFITY: 'Infiniti', INFITITY: 'Infiniti',
  INFINITY: 'Infiniti', JAGAUR: 'Jaguar', JAGUARS: 'Jaguar',
  PORCSHE: 'Porsche', POESCHE: 'Porsche', PEGUOT: 'Peugeot', PEGOUT: 'Peugeot',
  TOYATA: 'Toyota', ACCENT: 'Hyundai', DMAX: 'Isuzu', PARTNER: 'Peugeot',
  SILVERADO: 'Chevrolet', TROOPER: 'Isuzu',
})) MAKE_BY_KEY.set(identityKey(alias), make);

const PRODUCT_BRAND_BY_KEY = new Map();
for (const [canonical, aliases] of Object.entries({
  BOSCH: ['BOSH', 'BOSH-0242240566', 'BOSH-0242240628', 'BOSH-0242245581'],
  FEBI: ['FEBI BILSTEIN'],
  'General Motors': ['GENERAL MOTORS', 'GM'],
  'MANN-FILTER': ['MANN', 'MANN FILTER'],
  MEYLE: ['MEYLE'],
  REMSA: ['REMSA'],
  SCHNIEDER: ['SCHEINDER'], TOPDRIVE: ['TOP DRIVE'], TRUCKTEC: ['TRUCK TEC'],
  'Volkswagen Group': ['VAG'],
})) {
  for (const value of [canonical, ...aliases]) PRODUCT_BRAND_BY_KEY.set(identityKey(value), canonical);
}

const NON_BRANDS = new Set(['GENUINEOEM', 'OE', 'OEM', 'ORIGINAL', 'SHEET1', 'MODULE', 'TRUNK', 'UNKNOWN']);

function canonicalizeMake(value) {
  return canonicalizeMakes(value)[0] ?? null;
}

function canonicalizeSingleMake(value) {
  const raw = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const key = identityKey(raw);
  if (!key) return null;
  const exact = MAKE_BY_KEY.get(key);
  if (exact) return exact;
  if (/[\s\d]/.test(raw)) {
    for (const [makeKey, make] of MAKE_BY_KEY) {
      if (makeKey.length >= 4 && key.startsWith(makeKey) && key !== makeKey) return make;
    }
  }
  return raw;
}

function canonicalizeMakes(value) {
  const raw = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!raw) return [];

  const pieces = raw
    .split(/\s*(?:\/|\\|\+|,|&|\band\b)\s*/i)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.length > 1) {
    const makes = pieces.map(canonicalizeSingleMake).filter(Boolean);
    if (makes.length === pieces.length) return [...new Set(makes)];
  }

  const single = canonicalizeSingleMake(raw);
  return single ? [single] : [];
}

function maybeBrandCodePrefix(raw) {
  const match = raw.match(
    /^([A-Za-z0-9][A-Za-z0-9 .&+/]*?[A-Za-z0-9])\s*[-_:]\s*(?=[A-Za-z0-9 ._/-]*\d)[A-Za-z0-9 ._/-]+$/,
  );
  if (!match) return null;
  const prefix = String(match[1] ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const key = identityKey(prefix);
  const letterCount = (prefix.match(/[A-Za-z]/g) ?? []).length;
  if (letterCount < 2 || !key || NON_BRANDS.has(key)) return null;
  if (prefix.length > 40 || prefix.split(/\s+/).length > 4) return null;
  return prefix;
}

function canonicalizeBrandValue(raw, allowCodeStrip = true) {
  const key = identityKey(raw);
  if (!key || NON_BRANDS.has(key) || raw.length > 80) return null;
  if (allowCodeStrip) {
    const prefix = maybeBrandCodePrefix(raw);
    if (prefix) return canonicalizeBrandValue(prefix, false);
  }
  const exact = PRODUCT_BRAND_BY_KEY.get(key) || MAKE_BY_KEY.get(key);
  if (exact) return exact;
  const makes = canonicalizeMakes(raw);
  if (makes.length > 1) return makes[0];
  if (/[\s\d]/.test(raw) && makes[0] && makes[0] !== raw) return makes[0];
  return raw.toUpperCase();
}

function canonicalizeBrand(value) {
  const raw = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  return canonicalizeBrandValue(raw);
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
const SUPERIOR_SELLER_NAME_RE = /superior\s+auto\s+parts/i;
const SUPERFLOUS_SELLER_IDS = new Set([
  'seller-blackline-auto-parts',
  'seller-salvage-auto-parts',
  '21924d3c-b345-4dcd-900c-b4bcf92b01c0', // Blackline Auto Parts (production)
]);
const SUPERFLOUS_SELLER_NAME_RE = /\b(?:blackline|salvage)\s+auto\s+parts\b/i;

function sellerNameOf(o) {
  return o?.sellerName || o?.seller?.name || '';
}

function applySuperiorPriority(offers) {
  const hasSuperior = offers.some(
    (o) =>
      o.sellerId === SUPERIOR_SELLER_ID ||
      SUPERIOR_SELLER_NAME_RE.test(sellerNameOf(o)),
  );
  if (!hasSuperior) return offers;
  return offers.filter(
    (o) =>
      !SUPERFLOUS_SELLER_IDS.has(o.sellerId ?? '') &&
      !SUPERFLOUS_SELLER_NAME_RE.test(sellerNameOf(o)),
  );
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
    brand: canonicalizeBrand(part.brand),
    manufacturerPartNumber: sanitizeIdentifier(part.manufacturerPartNumber),
    partNumbers,
    normalizedPartNumbers: partNumbers
      .filter((n) => n.numberType !== 'OEM_CROSS_REFERENCE')
      .map((n) => n.normalizedNumber)
      .filter(Boolean),
    category: part.category,
    categoryGroup: part.categoryGroup ?? null,
    makes: [...new Set(
      [
        ...(Array.isArray(part.compatibility) ? part.compatibility.map((c) => c.make).filter(Boolean) : []),
        ...(part.fitments || [])
          .map((f) => f.vehicleConfig?.generation?.model?.make?.name)
          .filter(Boolean),
      ].flatMap(canonicalizeMakes).filter(Boolean),
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
