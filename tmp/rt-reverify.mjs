/**
 * Re-verify RealTrack after requirements fulfillment.
 */
const base = (process.env.REALTRACK_API_URL || '').replace(/\/$/, '');
const email = process.env.REALTRACK_API_EMAIL;
const password = process.env.REALTRACK_API_PASSWORD;

const TARGETS = {
  blackline: { id: 'd16199c4-55b5-429e-ad27-892bed94e00d', name: 'BLACKLINEAUTOPARTS' },
  salvageA: { id: '3b84b063-3811-481f-a61d-f7846a03558f', name: 'US SalvageA' },
  kSalvage: { id: 'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0', name: 'K. Salvage Auto Parts' },
};

async function login() {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${r.status} ${JSON.stringify(j)}`);
  return j.accessToken;
}

async function get(token, path) {
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

function analyze(listing) {
  const images = [];
  const push = (u) => {
    if (typeof u === 'string' && u.startsWith('http')) images.push(u);
  };
  (listing?.imageUrls || []).forEach(push);
  const item = listing?.rawEbayResponse?.item || {};
  push(item.imageUrl);
  push(item.pictureURL);
  push(item.galleryURL);
  const pics = item.pictureURLLarge || item.PictureURL || item.pictureUrls || item.imageUrls;
  if (Array.isArray(pics)) pics.forEach(push);
  else push(pics);
  try {
    const raw = JSON.stringify(listing?.rawEbayResponse || {});
    const matches = raw.match(/https?:\\?\/\\?\/[^"\\\s]+\.(?:jpg|jpeg|png|webp)/gi) || [];
    for (const m of matches) push(m.replace(/\\\//g, '/'));
  } catch {}
  const uniq = [...new Set(images)];

  const compat = listing?.compatibility;
  let compatCount = 0;
  if (Array.isArray(compat)) compatCount = compat.length;
  else if (Array.isArray(compat?.compatibleProducts)) compatCount = compat.compatibleProducts.length;
  else if (Array.isArray(compat?.vehicles)) compatCount = compat.vehicles.length;

  const desc =
    listing?.descriptionHtml ||
    listing?.descriptionText ||
    listing?.description ||
    item?.description ||
    '';
  const specifics = listing?.itemSpecifics;
  const specificsEmpty =
    specifics == null ||
    (Array.isArray(specifics) && specifics.length === 0) ||
    (typeof specifics === 'object' && !Array.isArray(specifics) && Object.keys(specifics).length === 0);

  return {
    id: listing.id,
    title: String(listing.title || '').slice(0, 90),
    listingStatus: listing.listingStatus || listing.status,
    qty: listing.quantityAvailable ?? listing.quantity,
    price: listing.price,
    currency: listing.currency,
    imageCount: uniq.length,
    ebayImageCount: uniq.filter((u) => /ebay/i.test(u)).length,
    largeEbayCount: uniq.filter((u) => /ebay/i.test(u) && /s-l(1600|1200|800)/i.test(u)).length,
    sampleImages: uniq.slice(0, 4),
    firstIsEbay: uniq[0] ? /ebay/i.test(uniq[0]) : false,
    compatCount,
    hasDescription: typeof desc === 'string' && desc.trim().length > 0,
    descriptionLen: typeof desc === 'string' ? desc.trim().length : 0,
    hasItemSpecifics: !specificsEmpty,
    condition: listing.condition || item.condition || null,
    brand: listing.brand || null,
    mpn: listing.mpn || listing.manufacturerPartNumber || null,
    lastSyncedAt: listing.lastSyncedAt || null,
    topKeys: Object.keys(listing || {}).sort(),
  };
}

async function probeStore(token, store, detailN = 8) {
  const active = await get(token, `/published-listings?page=1&limit=25&storeId=${store.id}`);
  const ended = await get(token, `/published-listings?page=1&limit=1&storeId=${store.id}&status=ended`);
  const items = active.body?.items || [];
  const details = [];
  const stats = {
    withImages: 0,
    withEbayImages: 0,
    with3plusImages: 0,
    withCompat: 0,
    withDescription: 0,
    withSpecifics: 0,
    withCondition: 0,
    firstImageEbay: 0,
  };

  const n = Math.min(detailN, items.length);
  for (let i = 0; i < n; i++) {
    const summary = items[i];
    let detail = summary;
    try {
      const d = await get(token, `/stores/${store.id}/listings/published/${summary.id}`);
      if (d.status === 200) detail = { ...summary, ...(d.body || {}) };
    } catch {}
    const a = analyze(detail);
    details.push(a);
    if (a.imageCount > 0) stats.withImages++;
    if (a.ebayImageCount > 0) stats.withEbayImages++;
    if (a.imageCount >= 3) stats.with3plusImages++;
    if (a.compatCount > 0) stats.withCompat++;
    if (a.hasDescription) stats.withDescription++;
    if (a.hasItemSpecifics) stats.withSpecifics++;
    if (a.condition) stats.withCondition++;
    if (a.firstIsEbay) stats.firstImageEbay++;
  }

  return {
    name: store.name,
    storeId: store.id,
    activeHttp: active.status,
    activeTotal: active.body?.total ?? null,
    endedTotal: ended.body?.total ?? null,
    sampledList: items.length,
    detailSampled: n,
    coverageOfSample: stats,
    samples: details.slice(0, 3),
  };
}

const token = await login();
const global = await get(token, '/published-listings?page=1&limit=1');
const stores = {};
for (const [key, store] of Object.entries(TARGETS)) {
  stores[key] = await probeStore(token, store, 8);
}

// Sum known marketplace + a few others for global sanity
const sumIds = [
  TARGETS.blackline.id,
  TARGETS.salvageA.id,
  TARGETS.kSalvage.id,
  'fa528c8a-f249-4816-94f6-f2ce8b932449',
  '65aff8ec-21ee-460f-af17-20daa0b843c1',
  '8d7d8b23-d769-4ed5-91e2-e26d14a45215',
  'cc658cc0-ab21-4519-9f06-4aea8ff6a809',
  '7658e52e-4dd6-48a7-ad78-6933630bdac7',
];
let sum = 0;
const per = [];
for (const id of sumIds) {
  const r = await get(token, `/published-listings?page=1&limit=1&storeId=${id}`);
  const t = r.body?.total || 0;
  sum += t;
  per.push({ storeId: id, total: t });
}

const canContinue =
  (stores.blackline.activeTotal || 0) > 0 && (stores.salvageA.activeTotal || 0) > 0;

const payloadReady =
  stores.blackline.detailSampled > 0 &&
  stores.salvageA.detailSampled > 0 &&
  (stores.blackline.coverageOfSample.withImages > 0 || stores.salvageA.coverageOfSample.withImages > 0);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      verdict: {
        canContinuePopulate: canContinue,
        reason: canContinue
          ? 'Both Blackline and SalvageA have active published listings'
          : 'One or both target stores still have 0 active listings',
        payloadEnrichmentLooksImproved: payloadReady,
        notes: [
          'Populate should use detail-fetch path (seed:realtrack-dynatrade / syncStoreComplete)',
          'If compat/description still weak in sample, catalog will still import but not full eBay parity',
        ],
      },
      global: { http: global.status, total: global.body?.total ?? null },
      sumOfSampledStores: sum,
      perStoreSampled: per,
      stores,
    },
    null,
    2,
  ),
);
