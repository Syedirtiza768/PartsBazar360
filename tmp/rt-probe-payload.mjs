/**
 * Probe RealTrack published-listings + detail payloads for Salvage / Blackline.
 */
const base = (process.env.REALTRACK_API_URL || 'https://mhn.realtrackapp.com/api').replace(/\/$/, '');
const email = process.env.REALTRACK_API_EMAIL;
const password = process.env.REALTRACK_API_PASSWORD;

const STORES = {
  salvage: {
    id: '3b84b063-3811-481f-a61d-f7846a03558f',
    slug: null,
    name: 'Salvage Auto Parts',
  },
  blackline: {
    id: 'd16199c4-55b5-429e-ad27-892bed94e00d',
    slug: 'blacklineusedautoparts',
    name: 'Blackline Auto Parts',
  },
};

function qty(listing) {
  const raw =
    listing?.quantityAvailable ?? listing?.quantity ?? listing?.availableQuantity ?? listing?.qty;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function isActive(listing) {
  const status = String(listing?.listingStatus ?? listing?.status ?? listing?.offerStatus ?? '')
    .trim()
    .toUpperCase();
  if (!status) return true;
  const inactive = [
    'ENDED',
    'INACTIVE',
    'DRAFT',
    'UNPUBLISHED',
    'OUT_OF_STOCK',
    'SOLD',
    'COMPLETED',
    'ARCHIVED',
    'DELETED',
    'WITHDRAWN',
  ];
  return !inactive.includes(status);
}

function isImportable(listing) {
  if (!isActive(listing)) return false;
  const q = qty(listing);
  return q === null ? true : q > 0;
}

function collectImages(listing) {
  const urls = [];
  const push = (u) => {
    if (typeof u === 'string' && u.startsWith('http')) urls.push(u);
  };
  if (Array.isArray(listing?.imageUrls)) listing.imageUrls.forEach(push);
  push(listing?.rawEbayResponse?.item?.imageUrl);
  push(listing?.rawEbayResponse?.item?.pictureURL);
  push(listing?.rawEbayResponse?.item?.galleryURL);
  const pics =
    listing?.rawEbayResponse?.item?.pictureURLLarge ||
    listing?.rawEbayResponse?.item?.PictureURL ||
    listing?.rawEbayResponse?.item?.pictureUrls;
  if (Array.isArray(pics)) pics.forEach(push);
  else push(pics);
  try {
    const raw = JSON.stringify(listing?.rawEbayResponse || {});
    const matches = raw.match(/https?:\\?\/\\?\/[^"\\\s]+\.(?:jpg|jpeg|png|webp)/gi) || [];
    for (const m of matches) push(m.replace(/\\\//g, '/'));
  } catch {
    /* ignore */
  }
  return [...new Set(urls)];
}

function compatRows(listing) {
  const c = listing?.compatibility;
  if (!c) return 0;
  if (Array.isArray(c)) return c.length;
  if (Array.isArray(c.compatibleProducts)) return c.compatibleProducts.length;
  if (Array.isArray(c.vehicles)) return c.vehicles.length;
  return 0;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function login() {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`auth ${res.status}: ${JSON.stringify(data)}`);
  return data.accessToken;
}

async function getJson(token, path, retries = 4) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(Math.min(15000, 1000 * 2 ** i));
        lastErr = new Error(`${path} -> ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      return res.json();
    } catch (e) {
      lastErr = e;
      await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

function analyze(listing) {
  const images = collectImages(listing);
  return {
    id: listing.id,
    title: String(listing.title || '').slice(0, 90),
    status: listing.listingStatus || listing.status || null,
    qty: qty(listing),
    qtyFields: {
      quantityAvailable: listing.quantityAvailable ?? null,
      quantity: listing.quantity ?? null,
      availableQuantity: listing.availableQuantity ?? null,
    },
    importable: isImportable(listing),
    imageCount: images.length,
    ebayImageCount: images.filter((u) => /ebay/i.test(u)).length,
    sampleImages: images.slice(0, 3),
    compatRows: compatRows(listing),
    hasCompatibilityField: listing.compatibility != null,
    hasCompatibleProducts: Array.isArray(listing?.compatibility?.compatibleProducts),
    hasRawEbay: !!listing.rawEbayResponse,
    keys: Object.keys(listing || {}).sort(),
  };
}

async function fetchList(token, store, limit = 25) {
  const attempts = [];
  // Prefer storeId (code path), then storeSlug fallback for Blackline.
  const queries = [`storeId=${encodeURIComponent(store.id)}`];
  if (store.slug) queries.push(`storeSlug=${encodeURIComponent(store.slug)}`);
  for (const q of queries) {
    try {
      const data = await getJson(token, `/published-listings?page=1&limit=${limit}&${q}`);
      attempts.push({ q, ok: true, total: data.total, count: (data.items || []).length });
      return { data, attempts };
    } catch (e) {
      attempts.push({ q, ok: false, error: String(e.message || e) });
    }
  }
  return { data: null, attempts };
}

async function probeStore(token, store) {
  const { data: list, attempts } = await fetchList(token, store, 25);
  if (!list) {
    return { name: store.name, storeId: store.id, error: 'list_failed', attempts };
  }
  const items = list.items || [];
  const stats = {
    importable: 0,
    inactive: 0,
    zeroQty: 0,
    missingQty: 0,
    withImagesList: 0,
    withImagesDetail: 0,
    withEbayDetail: 0,
    withCompatList: 0,
    withCompatDetail: 0,
  };
  const samples = [];
  let detailMs = 0;
  let detailOk = 0;

  // Detail only for first 8 to measure latency/coverage without hammering API.
  const detailN = Math.min(8, items.length);
  for (let i = 0; i < items.length; i++) {
    const summary = items[i];
    const listA = analyze(summary);
    if (listA.imageCount > 0) stats.withImagesList++;
    if (listA.compatRows > 0) stats.withCompatList++;

    let detail = summary;
    if (i < detailN) {
      const t0 = Date.now();
      try {
        detail = {
          ...summary,
          ...(await getJson(
            token,
            `/stores/${encodeURIComponent(store.id)}/listings/published/${encodeURIComponent(summary.id)}`,
          )),
        };
        detailOk++;
      } catch {
        /* keep summary */
      }
      detailMs += Date.now() - t0;
    }
    const d = analyze(detail);
    if (samples.length < 2) samples.push(d);

    if (d.importable) stats.importable++;
    else if (!isActive(detail)) stats.inactive++;
    else if (d.qty === 0) stats.zeroQty++;
    if (d.qty === null) stats.missingQty++;
    if (i < detailN) {
      if (d.imageCount > 0) stats.withImagesDetail++;
      if (d.ebayImageCount > 0) stats.withEbayDetail++;
      if (d.compatRows > 0) stats.withCompatDetail++;
    }
  }

  const n = Math.max(items.length, 1);
  const avgDetailMs = detailOk ? Math.round(detailMs / detailOk) : null;
  const estimatedImportable = Math.round((stats.importable / n) * (list.total || 0));
  const estimatedMinutes =
    avgDetailMs != null ? Math.round(((list.total || 0) * avgDetailMs) / 60000) : null;

  return {
    name: store.name,
    storeId: store.id,
    attempts,
    totalPublished: list.total || 0,
    sampled: items.length,
    detailSampled: detailN,
    sampleStats: stats,
    estimatedImportable,
    avgDetailMs,
    estimatedSyncMinutesDetailPath: estimatedMinutes,
    samples,
  };
}

const token = await login();
const out = {};
for (const [key, store] of Object.entries(STORES)) {
  console.error(`Probing ${store.name}...`);
  out[key] = await probeStore(token, store);
}
const totalImportable =
  (out.salvage?.estimatedImportable || 0) + (out.blackline?.estimatedImportable || 0);
const totalMinutes =
  (out.salvage?.estimatedSyncMinutesDetailPath || 0) +
  (out.blackline?.estimatedSyncMinutesDetailPath || 0);
console.log(
  JSON.stringify(
    {
      summary: {
        estimatedImportableTotal: totalImportable,
        estimatedSyncMinutesCurrentCodepath: totalMinutes,
        note: 'Importable ≈ ACTIVE/published + qty>0 (missing qty treated as in-stock). Time = detail-fetch path only; DB writes add more.',
      },
      stores: out,
    },
    null,
    2,
  ),
);
