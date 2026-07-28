/**
 * Sample rich detail from a live store + confirm Blackline/Salvage emptiness across statuses.
 */
const base = (process.env.REALTRACK_API_URL || '').replace(/\/$/, '');
const email = process.env.REALTRACK_API_EMAIL;
const password = process.env.REALTRACK_API_PASSWORD;

async function login() {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${r.status}`);
  return j.accessToken;
}

async function get(token, path) {
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

function summarizeListing(l) {
  if (!l) return null;
  const compat = l.compatibility;
  let compatCount = 0;
  if (Array.isArray(compat)) compatCount = compat.length;
  else if (Array.isArray(compat?.compatibleProducts)) compatCount = compat.compatibleProducts.length;
  else if (Array.isArray(compat?.vehicles)) compatCount = compat.vehicles.length;

  const images = [];
  const push = (u) => {
    if (typeof u === 'string' && u.startsWith('http')) images.push(u);
  };
  (l.imageUrls || []).forEach(push);
  const item = l.rawEbayResponse?.item || {};
  push(item.imageUrl);
  push(item.pictureURL);
  push(item.galleryURL);
  const pics = item.pictureURLLarge || item.PictureURL || item.pictureUrls;
  if (Array.isArray(pics)) pics.forEach(push);
  else push(pics);
  try {
    const raw = JSON.stringify(l.rawEbayResponse || {});
    const matches = raw.match(/https?:\\?\/\\?\/[^"\\\s]+\.(?:jpg|jpeg|png|webp)/gi) || [];
    for (const m of matches) push(m.replace(/\\\//g, '/'));
  } catch {}

  const uniq = [...new Set(images)];
  return {
    id: l.id,
    storeId: l.storeId,
    title: String(l.title || '').slice(0, 100),
    sku: l.sku,
    ebayItemId: l.ebayItemId,
    listingStatus: l.listingStatus || l.status,
    quantityAvailable: l.quantityAvailable ?? l.quantity,
    price: l.price,
    currency: l.currency,
    listingUrl: l.listingUrl,
    topLevelKeys: Object.keys(l).sort(),
    hasDescription: typeof l.description === 'string' && l.description.length > 0,
    descriptionLen: typeof l.description === 'string' ? l.description.length : 0,
    hasItemSpecifics: !!(l.itemSpecifics || l.rawEbayResponse?.item?.itemSpecifics),
    hasRawEbay: !!l.rawEbayResponse,
    rawEbayTopKeys: l.rawEbayResponse ? Object.keys(l.rawEbayResponse).sort() : [],
    rawEbayItemKeys: l.rawEbayResponse?.item ? Object.keys(l.rawEbayResponse.item).sort() : [],
    imageUrlsCount: Array.isArray(l.imageUrls) ? l.imageUrls.length : 0,
    collectedImageCount: uniq.length,
    ebayImageCount: uniq.filter((u) => /ebay/i.test(u)).length,
    sampleImages: uniq.slice(0, 5),
    compatCount,
    compatType: compat == null ? null : Array.isArray(compat) ? 'array' : typeof compat,
    compatSample:
      Array.isArray(compat?.compatibleProducts) && compat.compatibleProducts[0]
        ? {
            keys: Object.keys(compat.compatibleProducts[0]),
            props: (compat.compatibleProducts[0].compatibilityProperties || []).slice(0, 8),
          }
        : Array.isArray(compat) && compat[0]
          ? compat[0]
          : null,
    condition: l.condition || l.conditionId || item.condition || item.conditionId || null,
    brand: l.brand || item.brand || null,
    mpn: l.mpn || l.manufacturerPartNumber || item.mpn || null,
    healthFlags: l.healthFlags || null,
  };
}

const token = await login();

// Confirm emptiness for target stores across statuses
const targets = {
  blackline: 'd16199c4-55b5-429e-ad27-892bed94e00d',
  kSalvage: 'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0',
  salvageA: '3b84b063-3811-481f-a61d-f7846a03558f',
};
const targetScan = {};
for (const [name, storeId] of Object.entries(targets)) {
  const statuses = [null, 'active', 'ACTIVE', 'ENDED', 'ended', 'INACTIVE', 'UNPUBLISHED', 'OUT_OF_STOCK'];
  const rows = [];
  for (const status of statuses) {
    const q = status
      ? `/published-listings?page=1&limit=1&storeId=${storeId}&status=${status}`
      : `/published-listings?page=1&limit=1&storeId=${storeId}`;
    const res = await get(token, q);
    rows.push({ statusFilter: status, http: res.status, total: res.body?.total ?? null, message: res.body?.message });
  }
  // search within store
  const search = await get(token, `/published-listings?page=1&limit=1&storeId=${storeId}&search=a`);
  rows.push({ statusFilter: 'search=a', http: search.status, total: search.body?.total ?? null });
  targetScan[name] = { storeId, rows };
}

// Sample live store with data (Euro Japan) — list vs detail richness
const liveStoreId = '65aff8ec-21ee-460f-af17-20daa0b843c1';
const list = await get(token, `/published-listings?page=1&limit=5&storeId=${liveStoreId}`);
const samples = [];
for (const item of list.body?.items || []) {
  const detail = await get(token, `/stores/${liveStoreId}/listings/published/${item.id}`);
  samples.push({
    list: summarizeListing(item),
    detail: summarizeListing({ ...item, ...(detail.body || {}) }),
    detailHttp: detail.status,
  });
}

// Also sample Blackline detail route with a fake id to see 404 vs empty store
const bl404 = await get(
  token,
  `/stores/d16199c4-55b5-429e-ad27-892bed94e00d/listings/published/00000000-0000-0000-0000-000000000001`,
);

// Global unfiltered bug: sum of store totals vs global
const storeIds = [
  '79f249a5-31e0-42a8-978c-a99b0665c61b',
  'fa528c8a-f249-4816-94f6-f2ce8b932449',
  'd16199c4-55b5-429e-ad27-892bed94e00d',
  '5fc75f19-31f3-44e4-b1ae-6545055f7945',
  '65aff8ec-21ee-460f-af17-20daa0b843c1',
  'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0',
  'cc658cc0-ab21-4519-9f06-4aea8ff6a809',
  '7658e52e-4dd6-48a7-ad78-6933630bdac7',
  'cfcc4a9c-c41b-4166-ab41-989c00a6fad1',
  '8d7d8b23-d769-4ed5-91e2-e26d14a45215',
  '70ad5c44-6424-4998-815c-99adf28c2487',
  '3b84b063-3811-481f-a61d-f7846a03558f',
];
let sum = 0;
const totals = [];
for (const id of storeIds) {
  const r = await get(token, `/published-listings?page=1&limit=1&storeId=${id}`);
  const t = r.body?.total || 0;
  sum += t;
  totals.push({ storeId: id, total: t });
}
const global = await get(token, `/published-listings?page=1&limit=1`);

console.log(
  JSON.stringify(
    {
      diagnosedAt: new Date().toISOString(),
      targetScan,
      globalVsSum: { globalTotal: global.body?.total, sumOfStoreTotals: sum, perStore: totals },
      blacklineUnknownId: { status: bl404.status, message: bl404.body?.message || bl404.body },
      liveStoreSample: {
        storeId: liveStoreId,
        listTotal: list.body?.total,
        samples,
      },
    },
    null,
    2,
  ),
);
