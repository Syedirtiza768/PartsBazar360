/**
 * Enrich DXB-EXW OEM listings from PartSouq (image URLs + model compatibility).
 *
 * Lookup: GET https://partsouq.com/en/search/all?q={OEM}
 * Fetch uses Python cloudscraper (Cloudflare). Persist URLs only — never download binaries.
 *
 * Usage (inside API container or host with DATABASE_URL):
 *   node scripts/enrich-dxb-from-partsouq.mjs
 *   DXB_LIMIT=10 node scripts/enrich-dxb-from-partsouq.mjs
 *   DXB_FORCE=1 DXB_DELAY_MS=800 node scripts/enrich-dxb-from-partsouq.mjs
 *
 * Compatibility is catalog-declared (NOT verified A/B fit). Years are often unavailable
 * on PartSouq search cards — rows use year='-' with make/model from the site.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DELAY_MS = Number(process.env.DXB_DELAY_MS || 800);
const LIMIT = process.env.DXB_LIMIT ? Number(process.env.DXB_LIMIT) : null;
const FORCE = process.env.DXB_FORCE === '1';
const CONCURRENCY = Math.max(1, Number(process.env.DXB_CONCURRENCY || 1));
const STATE_PATH = process.env.DXB_STATE_PATH || '/tmp/dxb-partsouq-enrich-progress.json';
const INDEX_NAME = process.env.OPENSEARCH_INDEX || 'canonical_parts';
const SOURCE_FILE = process.env.DXB_SOURCE_FILE || 'DXB-EXW.xlsx';
const PYTHON = process.env.DXB_PYTHON || process.env.PARTSOUQ_PYTHON || 'python3';
const FETCH_SCRIPT =
  process.env.PARTSOUQ_FETCH_SCRIPT || path.join(__dirname, 'partsouq_fetch.py');

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
    const url = new URL(String(value).trim());
    url.hash = '';
    return url.toString();
  } catch {
    return String(value || '').trim();
  }
}

function buildCompatibilityRows(models, make) {
  const rows = [];
  const makeName = String(make || '-').trim() || '-';
  for (const raw of models || []) {
    const model = String(raw || '').trim();
    if (!model) continue;
    rows.push({
      year: '-',
      make: makeName,
      model,
      trim: '-',
      engine: '-',
      source: 'partsouq.com',
      raw: model,
    });
  }
  return rows;
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
    errors: state.errors.slice(-80),
  };
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(payload, null, 2));
}

function startFetchWorker(delayMs) {
  const child = spawn(
    PYTHON,
    [FETCH_SCRIPT, '--batch-jsonl', '--delay-ms', String(delayMs)],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let buffer = '';
  const pending = [];

  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (text.trim()) console.error(JSON.stringify({ event: 'partsouq_stderr', text: text.slice(0, 400) }));
  });

  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const waiter = pending.shift();
      if (!waiter) continue;
      try {
        waiter.resolve(JSON.parse(line));
      } catch (error) {
        waiter.reject(error);
      }
    }
  });

  child.on('exit', (code) => {
    while (pending.length) {
      pending.shift().reject(new Error(`partsouq_fetch.py exited with code ${code}`));
    }
  });

  return {
    fetch(pn, brand) {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(`${JSON.stringify({ pn, brand })}\n`);
      });
    },
    async close() {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      await sleep(200);
      if (!child.killed) child.kill('SIGTERM');
    },
  };
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

async function enrichOne(prisma, os, worker, part, state) {
  const pn =
    part.manufacturerPartNumber ||
    part.partNumbers?.find((n) => n.numberType === 'BRAND_MPN')?.displayNumber ||
    part.partNumbers?.[0]?.displayNumber;

  if (!pn) {
    state.skipped += 1;
    state.done.add(part.id);
    return { status: 'skipped', reason: 'no_part_number' };
  }

  const hasPartsouqImage = (part.imageUrls || []).some((u) =>
    /partsouq\.com/i.test(String(u)),
  );
  const hasCompat =
    Array.isArray(part.compatibility) &&
    part.compatibility.some((r) => r?.source === 'partsouq.com' || r?.model);
  if (!FORCE && hasPartsouqImage && hasCompat) {
    state.skipped += 1;
    state.done.add(part.id);
    return { status: 'skipped', reason: 'already_enriched' };
  }

  const live = await worker.fetch(pn, part.brand || null);
  if (!live?.ok) {
    state.notFound += 1;
    state.done.add(part.id);
    state.errors.push({ id: part.id, pn, error: live?.error || 'not_found' });
    return { status: 'not_found', pn, error: live?.error };
  }

  const imageUrls = [...new Set((live.imageUrls || []).map(normalizeImageUrl).filter((u) => u.startsWith('http')))];
  const compatibility = buildCompatibilityRows(live.models, live.make || part.brand);
  const mergedImages = [...new Set([...imageUrls, ...(part.imageUrls || [])])].slice(0, 20);
  const nextTitle =
    live.title && (!part.title || /Part\s*[–-]\s*/i.test(part.title))
      ? `${part.brand || live.make || 'OEM'} ${live.title}`.replace(/\s+/g, ' ').trim()
      : part.title;

  await prisma.canonicalPart.update({
    where: { id: part.id },
    data: {
      title: nextTitle,
      imageUrls: mergedImages,
      listingUrl: live.sourceUrl || part.listingUrl,
      oeNumbers: [...new Set([...(part.oeNumbers || []), pn].map((x) => String(x).trim()).filter(Boolean))],
      compatibility: compatibility.length > 0 ? compatibility : part.compatibility || undefined,
      fitmentStatus: 'NOT_VERIFIED',
      fitmentFlags: [...new Set([...(part.fitmentFlags || []), 'PARTSOUQ_DECLARED'])],
      updatedAt: new Date(),
    },
  });

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
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
        sourceUrl: live.sourceUrl,
        sortOrder: i,
        isPrimary: i === 0,
        mediaType: 'IMAGE',
        importStatus: 'IMPORTED',
        altText: nextTitle,
      },
      create: {
        canonicalPartId: part.id,
        url,
        normalizedUrl,
        sourceUrl: live.sourceUrl,
        sortOrder: i,
        isPrimary: i === 0,
        mediaType: 'IMAGE',
        importStatus: 'IMPORTED',
        altText: nextTitle,
      },
    });
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
    pn,
    images: imageUrls.length,
    models: (live.models || []).length,
    url: live.sourceUrl,
  };
}

async function loadDxbParts(prisma) {
  const rows = await prisma.sourceRecord.findMany({
    where: { sourceFileName: SOURCE_FILE, sellerOfferId: { not: null } },
    select: { sellerOfferId: true },
  });
  const offerIds = [...new Set(rows.map((r) => r.sellerOfferId).filter(Boolean))];
  if (offerIds.length === 0) return [];

  const offers = await prisma.sellerOffer.findMany({
    where: { id: { in: offerIds } },
    select: { canonicalPartId: true },
  });
  const partIds = [...new Set(offers.map((o) => o.canonicalPartId))];

  return prisma.canonicalPart.findMany({
    where: { id: { in: partIds } },
    select: {
      id: true,
      title: true,
      brand: true,
      manufacturerPartNumber: true,
      imageUrls: true,
      listingUrl: true,
      oeNumbers: true,
      fitmentFlags: true,
      compatibility: true,
      partNumbers: {
        select: { displayNumber: true, numberType: true, normalizedNumber: true },
      },
    },
    orderBy: { brand: 'asc' },
  });
}

async function mapPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });
  const os = process.env.OPENSEARCH_URL
    ? new OpenSearchClient({ node: process.env.OPENSEARCH_URL })
    : null;

  const state = await loadState();
  const worker = startFetchWorker(DELAY_MS);

  console.log(
    JSON.stringify({
      event: 'start',
      sourceFile: SOURCE_FILE,
      delayMs: DELAY_MS,
      concurrency: CONCURRENCY,
      limit: LIMIT,
      force: FORCE,
      alreadyDone: state.done.size,
      statePath: STATE_PATH,
      python: PYTHON,
      fetchScript: FETCH_SCRIPT,
    }),
  );

  try {
    let parts = await loadDxbParts(prisma);
    console.log(JSON.stringify({ event: 'loaded_dxb_parts', count: parts.length }));

    if (!FORCE) {
      parts = parts.filter((p) => !state.done.has(p.id));
    }
    if (LIMIT != null) parts = parts.slice(0, LIMIT);

    await mapPool(parts, CONCURRENCY, async (part) => {
      try {
        const result = await enrichOne(prisma, os, worker, part, state);
        console.log(JSON.stringify({ event: 'part', id: part.id, ...result }));
      } catch (error) {
        state.fail += 1;
        state.done.add(part.id);
        state.errors.push({
          id: part.id,
          error: error instanceof Error ? error.message : String(error),
        });
        console.log(
          JSON.stringify({
            event: 'part',
            id: part.id,
            status: 'fail',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      if ((state.ok + state.fail + state.notFound + state.skipped) % 25 === 0) {
        await saveState(state);
      }
    });
  } finally {
    await saveState(state);
    await worker.close();
    await prisma.$disconnect();
  }

  console.log(
    JSON.stringify({
      event: 'done',
      ok: state.ok,
      fail: state.fail,
      skipped: state.skipped,
      notFound: state.notFound,
      done: state.done.size,
      statePath: STATE_PATH,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
