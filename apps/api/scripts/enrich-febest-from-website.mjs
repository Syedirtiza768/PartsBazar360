/**
 * Enrich FEBEST catalog parts from febest.de (images + compatible models + OEM refs).
 *
 * Lookup: GET https://febest.de/en/catalog?code={MPN}
 * Details: GET https://febest.de/en/details/{slug}
 *
 * Usage (inside API container):
 *   node /app/scripts/enrich-febest-from-website.mjs
 *   FEBEST_LIMIT=5 node /app/scripts/enrich-febest-from-website.mjs
 *   FEBEST_FORCE=1 FEBEST_DELAY_MS=400 node /app/scripts/enrich-febest-from-website.mjs
 *
 * Evidence is catalog-declared (NOT verified A/B fitment). Compatibility is stored
 * as year/make/model rows for the buyer PDP table; Fitment graph is not claimed.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://febest.de';
const USER_AGENT =
  'PartsBazar360CatalogBot/1.0 (+https://partsbazar360.realtrackapp.com; catalog enrichment; contact: ops)';
const SELLER_ID = process.env.FEBEST_SELLER_ID || 'seed-febest-inventory-supplier';
const DELAY_MS = Number(process.env.FEBEST_DELAY_MS || 400);
const LIMIT = process.env.FEBEST_LIMIT ? Number(process.env.FEBEST_LIMIT) : null;
const FORCE = process.env.FEBEST_FORCE === '1';
const CONCURRENCY = Math.max(1, Number(process.env.FEBEST_CONCURRENCY || 2));
const STATE_PATH =
  process.env.FEBEST_STATE_PATH || '/tmp/febest-enrich-progress.json';
const INDEX_NAME = process.env.OPENSEARCH_INDEX || 'canonical_parts';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizePartNumber(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeImageUrl(value) {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    return url.toString();
  } catch {
    return value.trim();
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en',
    },
    redirect: 'follow',
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, url: res.url, text };
}

function findDetailsPath(html, code) {
  const codeSlug = String(code).toLowerCase().replace(/-/g, '_');
  const exact = new RegExp(
    `href="(/en/details/[^"]*-${escapeRegExp(codeSlug)})"`,
    'i',
  );
  const m = html.match(exact);
  if (m) return m[1];

  // Fallback: first details link whose slug ends with code slug
  const all = [...html.matchAll(/href="(\/en\/details\/[^"]+)"/gi)].map((x) => x[1]);
  const hit = all.find((href) => href.toLowerCase().endsWith(`-${codeSlug}`));
  return hit || null;
}

function parseOemOptions(html) {
  const block = html.match(/id="oem_select"[^>]*>([\s\S]*?)<\/select>/i);
  if (!block) return [];
  const opts = [...block[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>/gi)]
    .map((m) => m[1].trim())
    .filter((v) => v && v !== '0');
  return [...new Set(opts)];
}

function parseModelOptions(html) {
  const block = html.match(/id="model_list"[^>]*>([\s\S]*?)<\/select>/i);
  if (!block) return [];
  const opts = [...block[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  return [...new Set(opts)];
}

function parseImages(html) {
  const urls = [...html.matchAll(/https:\/\/static\.febest\.de\/images\/[^"'>\s]+/gi)].map(
    (m) => m[0].replace(/&amp;/g, '&'),
  );
  const unique = [...new Set(urls)];
  const big = unique.filter((u) => /\/images\/big\//i.test(u));
  const photos = unique.filter(
    (u) => !/\/images\/big\//i.test(u) && /_p\d+\.(jpg|jpeg|png|webp)$/i.test(u),
  );
  const rest = unique.filter(
    (u) =>
      !big.includes(u) &&
      !photos.includes(u) &&
      !/_s\d+\.(png|jpg|jpeg|webp)$/i.test(u), // skip schemes as primary
  );
  const ordered = [...big, ...photos, ...rest];
  return ordered.slice(0, 12);
}

function parseModelLine(raw) {
  // Examples:
  //   FORD RANGER ES 2009-2012 [EU]
  //   FORD EVEREST EP 2009- [EU]
  //   TOYOTA RAV4 ACA2# 2000.08-2005.11 [EU]
  const m = String(raw).match(
    /^(\S+)\s+(.+?)\s+(\d{4})(?:\.(\d{2}))?\s*-\s*(?:(\d{4})(?:\.(\d{2}))?)?\s*\[([^\]]+)\]\s*$/,
  );
  if (!m) {
    return {
      make: null,
      model: raw,
      startYear: null,
      endYear: null,
      market: null,
      raw,
    };
  }
  const startYear = Number(m[3]);
  const endYear = m[5] ? Number(m[5]) : new Date().getFullYear();
  return {
    make: m[1],
    model: m[2].trim(),
    startYear,
    endYear: Math.max(endYear, startYear),
    market: m[7],
    raw,
  };
}

function buildCompatibilityRows(models) {
  const rows = [];
  const currentYear = new Date().getFullYear();
  for (const raw of models) {
    const parsed = parseModelLine(raw);
    if (!parsed.make || !parsed.startYear) {
      rows.push({
        year: '-',
        make: parsed.make || '-',
        model: parsed.model || raw,
        trim: '-',
        engine: '-',
        source: 'febest.de',
        market: parsed.market || null,
        raw,
      });
      continue;
    }
    const from = parsed.startYear;
    const to = Math.min(parsed.endYear || currentYear, from + 40);
    for (let year = from; year <= to; year++) {
      rows.push({
        year,
        make: parsed.make,
        model: parsed.model,
        trim: '-',
        engine: '-',
        source: 'febest.de',
        market: parsed.market,
        raw,
      });
    }
  }
  return rows;
}

function parseDetailsPage(html, code) {
  const codeMatch = html.match(/class="detPartCode"[^>]*>\s*Code:\s*([^<]+)/i);
  const pageCode = codeMatch ? codeMatch[1].trim() : code;
  const images = parseImages(html);
  const oems = parseOemOptions(html);
  const models = parseModelOptions(html);
  return {
    pageCode,
    images,
    oems,
    models,
    compatibility: buildCompatibilityRows(models),
  };
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    const json = JSON.parse(raw);
    return {
      done: new Set(json.done || []),
      ok: json.ok || 0,
      fail: json.fail || 0,
      skipped: json.skipped || 0,
      notFound: json.notFound || 0,
      errors: json.errors || [],
    };
  } catch {
    return { done: new Set(), ok: 0, fail: 0, skipped: 0, notFound: 0, errors: [] };
  }
}

async function saveState(state) {
  const payload = {
    updatedAt: new Date().toISOString(),
    ok: state.ok,
    fail: state.fail,
    skipped: state.skipped,
    notFound: state.notFound,
    done: [...state.done],
    errors: state.errors.slice(-50),
  };
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(payload, null, 2));
}

async function indexPart(os, part) {
  if (!os) return;
  const minPrice =
    Array.isArray(part.offers) && part.offers.length > 0
      ? Math.min(...part.offers.map((o) => o.price ?? Infinity))
      : null;
  await os.index({
    index: INDEX_NAME,
    id: part.id,
    body: {
      id: part.id,
      title: part.title,
      partType: part.partType || null,
      brand: part.brand,
      manufacturerPartNumber: part.manufacturerPartNumber || null,
      partNumbers: (part.partNumbers || []).map((n) => ({
        displayNumber: n.displayNumber,
        normalizedNumber: n.normalizedNumber,
        numberType: n.numberType,
      })),
      normalizedPartNumbers: (part.partNumbers || [])
        .filter((n) => n.numberType !== 'OEM_CROSS_REFERENCE')
        .map((n) => n.normalizedNumber)
        .filter(Boolean),
      category: part.category,
      oeNumbers: part.oeNumbers,
      interchangePartNumbers: (part.partNumbers || [])
        .filter((n) => n.numberType === 'OEM_CROSS_REFERENCE')
        .map((n) => n.normalizedNumber)
        .filter(Boolean),
      imageUrls: part.imageUrls || [],
      listingUrl: part.listingUrl || null,
      ebayItemId: part.ebayItemId || null,
      compatibility: part.compatibility || null,
      partSource: part.partSource || null,
      qualityTier: part.qualityTier || null,
      fitmentStatus: part.fitmentStatus || null,
      fitmentConfidence: part.fitmentConfidence ?? null,
      createdAt: part.createdAt || new Date().toISOString(),
      minPrice: Number.isFinite(minPrice) ? minPrice : null,
      fitments: [],
      offers: (part.offers || []).map((o) => ({
        id: o.id,
        price: o.price,
        currency: o.currency || null,
        condition: o.condition,
        partSource: o.partSource || null,
        qualityTier: o.qualityTier || null,
        sellerId: o.sellerId,
        sellerName: o.seller?.name || null,
        status: o.status,
      })),
    },
  });
}

async function enrichOne(prisma, os, part, state) {
  const code = part.manufacturerPartNumber;
  if (!code) {
    state.skipped += 1;
    state.done.add(part.id);
    return { status: 'skipped', reason: 'no_mpn' };
  }

  const rows = Array.isArray(part.compatibility) ? part.compatibility : [];
  const hasYear = rows.some((r) => typeof r?.year === 'number');
  const hasImages = (part.imageUrls || []).some((u) =>
    String(u).includes('static.febest.de'),
  );
  const already =
    !FORCE &&
    part.listingUrl?.includes('febest.de/en/details/') &&
    hasImages &&
    (hasYear || rows.length === 0);
  if (already) {
    state.skipped += 1;
    state.done.add(part.id);
    return { status: 'skipped', reason: 'already_enriched' };
  }

  const catalogUrl = `${BASE}/en/catalog?code=${encodeURIComponent(code)}`;
  const catalog = await fetchText(catalogUrl);
  await sleep(DELAY_MS);
  if (!catalog.ok) {
    throw new Error(`catalog HTTP ${catalog.status} for ${code}`);
  }

  const detailsPath = findDetailsPath(catalog.text, code);
  if (!detailsPath) {
    state.notFound += 1;
    state.done.add(part.id);
    state.errors.push({ id: part.id, code, error: 'details_not_found' });
    return { status: 'not_found' };
  }

  const detailsUrl = `${BASE}${detailsPath}`;
  const details = await fetchText(detailsUrl);
  await sleep(DELAY_MS);
  if (!details.ok) {
    throw new Error(`details HTTP ${details.status} for ${code}`);
  }

  const parsed = parseDetailsPage(details.text, code);
  if (parsed.images.length === 0 && parsed.models.length === 0 && parsed.oems.length === 0) {
    state.notFound += 1;
    state.done.add(part.id);
    state.errors.push({ id: part.id, code, error: 'empty_parse', url: detailsUrl });
    return { status: 'not_found' };
  }

  const mergedImages = [
    ...new Set([...(parsed.images || []), ...(part.imageUrls || [])].map(normalizeImageUrl)),
  ].slice(0, 20);
  const mergedOe = [
    ...new Set([...(part.oeNumbers || []), ...parsed.oems].map((x) => String(x).trim()).filter(Boolean)),
  ];

  await prisma.canonicalPart.update({
    where: { id: part.id },
    data: {
      imageUrls: mergedImages,
      listingUrl: detailsUrl,
      oeNumbers: mergedOe,
      compatibility: parsed.compatibility,
      fitmentStatus: 'NOT_VERIFIED',
      fitmentFlags: [
        ...new Set([...(part.fitmentFlags || []), 'FEBEST_WEBSITE_DECLARED']),
      ],
      updatedAt: new Date(),
    },
  });

  for (let i = 0; i < parsed.images.length; i++) {
    const url = normalizeImageUrl(parsed.images[i]);
    const normalizedUrl = url;
    await prisma.productMedia.upsert({
      where: {
        canonicalPartId_normalizedUrl: {
          canonicalPartId: part.id,
          normalizedUrl,
        },
      },
      update: {
        url,
        sourceUrl: detailsUrl,
        sortOrder: i,
        isPrimary: i === 0,
        mediaType: 'IMAGE',
        importStatus: 'IMPORTED',
        altText: part.title,
      },
      create: {
        canonicalPartId: part.id,
        url,
        normalizedUrl,
        sourceUrl: detailsUrl,
        sortOrder: i,
        isPrimary: i === 0,
        mediaType: 'IMAGE',
        importStatus: 'IMPORTED',
        altText: part.title,
      },
    });
  }

  for (const oem of parsed.oems) {
    const normalizedNumber = normalizePartNumber(oem);
    if (!normalizedNumber) continue;
    const existing = await prisma.catalogPartNumber.findFirst({
      where: {
        canonicalPartId: part.id,
        numberType: 'OEM_CROSS_REFERENCE',
        normalizedNumber,
        brandId: null,
        vehicleMakeId: null,
      },
    });
    if (existing) {
      await prisma.catalogPartNumber.update({
        where: { id: existing.id },
        data: {
          displayNumber: oem,
          source: 'FEBEST_WEBSITE',
          verificationStatus: 'SELLER_DECLARED',
          confidence: 0.55,
          metadata: { sourceUrl: detailsUrl },
        },
      });
    } else {
      await prisma.catalogPartNumber.create({
        data: {
          canonicalPartId: part.id,
          displayNumber: oem,
          normalizedNumber,
          numberType: 'OEM_CROSS_REFERENCE',
          source: 'FEBEST_WEBSITE',
          verificationStatus: 'SELLER_DECLARED',
          confidence: 0.55,
          metadata: { sourceUrl: detailsUrl },
        },
      });
    }
  }

  const updated = await prisma.canonicalPart.findUnique({
    where: { id: part.id },
    include: {
      partNumbers: true,
      offers: { include: { seller: true } },
    },
  });
  await indexPart(os, updated);

  state.ok += 1;
  state.done.add(part.id);
  return {
    status: 'ok',
    code,
    images: parsed.images.length,
    models: parsed.models.length,
    oems: parsed.oems.length,
    url: detailsUrl,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });
  const os = process.env.OPENSEARCH_URL
    ? new OpenSearchClient({ node: process.env.OPENSEARCH_URL })
    : null;

  const state = await loadState();
  console.log(
    JSON.stringify({
      event: 'start',
      sellerId: SELLER_ID,
      delayMs: DELAY_MS,
      concurrency: CONCURRENCY,
      limit: LIMIT,
      force: FORCE,
      alreadyDone: state.done.size,
      statePath: STATE_PATH,
    }),
  );

  const offers = await prisma.sellerOffer.findMany({
    where: { sellerId: SELLER_ID },
    select: { canonicalPartId: true },
    distinct: ['canonicalPartId'],
  });
  const partIds = offers.map((o) => o.canonicalPartId);
  console.log(JSON.stringify({ event: 'loaded_part_ids', count: partIds.length }));

  let parts = await prisma.canonicalPart.findMany({
    where: { id: { in: partIds } },
    select: {
      id: true,
      title: true,
      manufacturerPartNumber: true,
      imageUrls: true,
      listingUrl: true,
      oeNumbers: true,
      fitmentFlags: true,
      compatibility: true,
    },
    orderBy: { manufacturerPartNumber: 'asc' },
  });

  if (!FORCE) {
    parts = parts.filter((p) => {
      const rows = Array.isArray(p.compatibility) ? p.compatibility : [];
      const hasYear = rows.some((r) => typeof r?.year === 'number');
      const hasImages = (p.imageUrls || []).some((u) =>
        String(u).includes('static.febest.de'),
      );
      const linked = Boolean(p.listingUrl?.includes('febest.de/en/details/'));
      // Done when linked + images, and either expanded years or no models on site.
      if (linked && hasImages && (hasYear || rows.length === 0)) return false;
      return true;
    });
  }
  if (LIMIT != null) {
    parts = parts.slice(0, LIMIT);
  }

  console.log(JSON.stringify({ event: 'queue', count: parts.length }));

  let cursor = 0;
  async function worker(workerId) {
    while (cursor < parts.length) {
      const idx = cursor++;
      const part = parts[idx];
      try {
        const result = await enrichOne(prisma, os, part, state);
        if (idx % 25 === 0 || result.status === 'ok') {
          console.log(
            JSON.stringify({
              event: 'progress',
              worker: workerId,
              idx: idx + 1,
              total: parts.length,
              ...result,
              ok: state.ok,
              fail: state.fail,
              skipped: state.skipped,
              notFound: state.notFound,
            }),
          );
        }
      } catch (err) {
        state.fail += 1;
        state.errors.push({
          id: part.id,
          code: part.manufacturerPartNumber,
          error: String(err?.message || err),
        });
        console.error(
          JSON.stringify({
            event: 'error',
            id: part.id,
            code: part.manufacturerPartNumber,
            error: String(err?.message || err),
          }),
        );
        // Do not mark done on transient failures so resume retries.
        await sleep(DELAY_MS * 2);
      }
      if ((state.ok + state.fail + state.skipped + state.notFound) % 10 === 0) {
        await saveState(state);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  await saveState(state);

  console.log(
    JSON.stringify({
      event: 'done',
      ok: state.ok,
      fail: state.fail,
      skipped: state.skipped,
      notFound: state.notFound,
      done: state.done.size,
    }),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
