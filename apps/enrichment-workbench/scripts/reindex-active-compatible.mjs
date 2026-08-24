#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const OS = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
const INDEX = process.env.INDEX || 'parts_search';
const BATCH = Math.max(50, Number(process.env.BATCH || 200));
const WORKERS = Math.max(1, Math.min(16, Number(process.env.WORKERS || 8) || 8));
const BRAND = text(process.env.BRAND);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function normalizeNumber(value) {
  return text(value).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalized(values) {
  return unique(values.map(normalizeNumber).filter((value) => value.length >= 3));
}

function compatibilityYears(rows) {
  const years = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const from = Number(row?.yearFrom ?? row?.year);
    const to = Number(row?.yearTo ?? row?.year);
    if (!Number.isFinite(from) || from < 1950 || from > 2049) continue;
    const end = Number.isFinite(to) && to >= from && to - from <= 40 ? to : from;
    for (let year = from; year <= end && year <= 2049; year += 1) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

function numbersFor(part) {
  const catalogue = Array.isArray(part.partNumbers) ? part.partNumbers : [];
  const byType = (types) => catalogue
    .filter((row) => types.has(String(row?.numberType || '')))
    .flatMap((row) => [row?.normalizedNumber, row?.displayNumber]);
  const oemNumbers = normalized([
    ...(Array.isArray(part.oeNumbers) ? part.oeNumbers : []),
    part.manufacturerPartNumber,
    ...byType(new Set(['BRAND_MPN', 'OEM'])),
  ]);
  const interchangeNumbers = normalized(byType(new Set(['OEM_CROSS_REFERENCE', 'INTERCHANGE'])));
  const supersededNumbers = normalized(byType(new Set(['SUPERSEDED'])));
  const skuNumbers = normalized([
    ...((part.offers || []).map((offer) => offer.sellerSku)),
    ...byType(new Set(['SELLER_SKU', 'SKU'])),
  ]);
  return {
    oemNumbers,
    interchangeNumbers,
    supersededNumbers,
    skuNumbers,
    searchNumbers: normalized([...oemNumbers, ...interchangeNumbers, ...supersededNumbers, ...skuNumbers]),
    displayNumbers: unique([
      part.manufacturerPartNumber,
      ...(Array.isArray(part.oeNumbers) ? part.oeNumbers : []),
      ...catalogue.map((row) => row?.displayNumber),
    ]),
  };
}

function visibleOffers(part) {
  const offers = (part.offers || []).filter((offer) => {
    if (offer.status !== 'ACTIVE') return false;
    if (offer.seller?.onboardingStatus !== 'ACTIVE') return false;
    if (Number(offer.price) <= 0) return false;
    return true;
  });
  const hasSuperior = offers.some((offer) => offer.sellerId === 'seller-superior-auto-parts' || /superior\s+auto\s+parts/i.test(offer.seller?.name || ''));
  if (!hasSuperior) return offers;
  return offers.filter((offer) => !/^(?:blackline|salvage)\s+auto\s+parts$/i.test(offer.seller?.name || '') && !['seller-blackline-auto-parts', 'seller-salvage-auto-parts', '21924d3c-b345-4dcd-900c-b4bcf92b01c0'].includes(offer.sellerId));
}

function toDocument(part) {
  const offers = visibleOffers(part);
  if (offers.length === 0) return null;
  const compatibility = Array.isArray(part.compatibility) ? part.compatibility : [];
  const numbers = numbersFor({ ...part, offers });
  const fitments = (part.fitments || [])
    .filter((fitment) => ['A', 'B'].includes(fitment.evidenceLevel) && Number(fitment.confidence) >= 0.8)
    .map((fitment) => fitment.vehicleConfigId)
    .filter(Boolean);
  const makes = unique([
    ...compatibility.map((row) => row?.make),
    ...(part.fitments || []).map((fitment) => fitment.vehicleConfig?.generation?.model?.make?.name),
  ]);
  const models = unique(compatibility.map((row) => row?.model));
  const imageUrls = unique((Array.isArray(part.imageUrls) ? part.imageUrls : []).filter((url) => !/\.svg(?:\?.*)?$/i.test(url)));
  const prices = offers.map((offer) => Number(offer.price)).filter(Number.isFinite).filter((price) => price > 0);
  return {
    id: part.id,
    title: part.title || null,
    description: part.description || null,
    ...numbers,
    manufacturerPartNumber: normalizeNumber(part.manufacturerPartNumber) || null,
    partType: part.partType || null,
    partSource: part.partSource || null,
    qualityTier: part.qualityTier || null,
    brand: part.brand || null,
    brandDisplay: part.brand || null,
    category: part.category || null,
    sourceTags: unique(offers.map((offer) => offer.sourceTag)),
    makes,
    models,
    years: compatibilityYears(compatibility),
    side: part.side || null,
    positions: unique([part.position]),
    conditions: unique(offers.map((offer) => offer.condition)),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    currencies: unique(offers.map((offer) => offer.currency)),
    sellerIds: unique(offers.map((offer) => offer.sellerId)),
    sellerNames: unique(offers.map((offer) => offer.seller?.name)),
    offerCount: offers.length,
    inStock: offers.some((offer) => offer.inStock !== false),
    hasImage: imageUrls.length > 0,
    freeShipping: offers.some((offer) => offer.freeShipping === true),
    fitments,
    verifiedFitments: fitments,
    fitmentStatus: part.fitmentStatus || null,
    fitmentConfidence: part.fitmentConfidence ?? null,
    listingQuality: Math.min(1, (imageUrls.length ? 0.3 : 0) + (part.title ? 0.15 : 0) + (part.description ? 0.1 : 0) + (part.manufacturerPartNumber ? 0.15 : 0) + (part.brand ? 0.1 : 0) + (fitments.length ? 0.1 : 0) + (offers.length > 1 ? 0.1 : 0)),
    popularity: Number(part.popularity) || 0,
    imageUrls,
    listingUrl: part.listingUrl || null,
    ebayItemId: part.ebayItemId || null,
    createdAt: part.createdAt?.toISOString?.() || part.createdAt || new Date().toISOString(),
    updatedAt: part.updatedAt?.toISOString?.() || part.updatedAt || null,
    indexedAt: new Date().toISOString(),
    offers: offers.map((offer) => ({
      id: offer.id,
      sellerId: offer.sellerId || null,
      sellerName: offer.seller?.name || null,
      price: Number.isFinite(Number(offer.price)) ? Number(offer.price) : null,
      currency: offer.currency || null,
      condition: offer.condition || null,
      partSource: offer.partSource || null,
      qualityTier: offer.qualityTier || null,
      sourceTag: offer.sourceTag || null,
      inStock: offer.inStock !== false,
      freeShipping: offer.freeShipping === true,
    })),
  };
}

async function os(path, options = {}) {
  const response = await fetch(`${OS}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const body = await response.text();
  const json = body ? JSON.parse(body) : {};
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${body.slice(0, 500)}`);
  return json;
}

async function bulkIndex(documents) {
  if (!documents.length) return { ok: 0, errors: [] };
  const body = `${documents.map((doc) => `${JSON.stringify({ index: { _index: INDEX, _id: doc.id } })}\n${JSON.stringify(doc)}`).join('\n')}\n`;
  const result = await os('/_bulk?refresh=false', { method: 'POST', body });
  const errors = [];
  for (const item of result.items || []) {
    const error = item.index?.error;
    if (error) errors.push({ id: item.index?._id, type: error.type, reason: error.reason });
  }
  return { ok: documents.length - errors.length, errors };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const eligible = await prisma.sellerOffer.findMany({
      where: {
        status: 'ACTIVE',
        seller: { onboardingStatus: 'ACTIVE' },
        ...(BRAND ? { canonicalPart: { brand: { equals: BRAND, mode: 'insensitive' } } } : {}),
      },
      select: { canonicalPartId: true },
      distinct: ['canonicalPartId'],
    });
    const ids = eligible.map((row) => row.canonicalPartId);
    const queue = [];
    for (let offset = 0; offset < ids.length; offset += BATCH) queue.push(ids.slice(offset, offset + BATCH));
    let completed = 0;
    let indexed = 0;
    let failed = 0;
    async function worker(workerId) {
      while (queue.length) {
        const slice = queue.shift();
        const parts = await prisma.canonicalPart.findMany({
          where: { id: { in: slice } },
          include: {
            partNumbers: true,
            fitments: { include: { vehicleConfig: { include: { generation: { include: { model: { include: { make: true } } } } } } } },
            offers: { where: {
        status: 'ACTIVE',
        seller: { onboardingStatus: 'ACTIVE' },
        ...(BRAND ? { canonicalPart: { brand: { equals: BRAND, mode: 'insensitive' } } } : {}),
      }, include: { seller: { select: { name: true, onboardingStatus: true } } } },
          },
        });
        const documents = parts.map(toDocument).filter(Boolean);
        const result = await bulkIndex(documents);
        completed += slice.length;
        indexed += result.ok;
        failed += result.errors.length;
        if (result.errors.length) console.error(`worker=${workerId} errors`, result.errors.slice(0, 3));
        console.log(`worker=${workerId} completed=${completed}/${ids.length} indexed=${indexed} failed=${failed}`);
      }
    }
    console.log(`Reindexing ${ids.length}${BRAND ? ` ${BRAND}` : ''} active parts into ${INDEX} with ${WORKERS} parallel workers (batch=${BATCH})`);
    await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length || 1) }, (_, index) => worker(index + 1)));
    await os(`/${INDEX}/_refresh`, { method: 'POST' });
    const count = await os(`/${INDEX}/_count`);
    console.log(JSON.stringify({ ids: ids.length, indexed, failed, openSearchDocs: count.count ?? null, workers: WORKERS, batch: BATCH }));
    process.exitCode = failed ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
