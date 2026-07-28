/** Sample SalvageA titles — try multiple list filters. */
const base = (process.env.REALTRACK_API_URL || '').replace(/\/$/, '');
const email = process.env.REALTRACK_API_EMAIL;
const password = process.env.REALTRACK_API_PASSWORD;
const STORE = '3b84b063-3811-481f-a61d-f7846a03558f';

async function login() {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('auth fail ' + JSON.stringify(j));
  return j.accessToken;
}

async function get(token, path) {
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  return { status: r.status, body };
}

const token = await login();
const probes = [
  `/published-listings?storeId=${STORE}&limit=5`,
  `/published-listings?storeId=${STORE}&limit=5&listingStatus=ACTIVE`,
  `/published-listings?storeId=${STORE}&limit=5&status=PUBLISHED`,
  `/stores/${STORE}/published-listings?limit=5`,
];
for (const p of probes) {
  const res = await get(token, p);
  const items = res.body?.items || res.body?.data || res.body?.listings || [];
  console.log(JSON.stringify({
    path: p,
    status: res.status,
    total: res.body?.total,
    count: res.body?.count,
    items: items.length,
    firstKeys: items[0] ? Object.keys(items[0]).slice(0, 25) : [],
    firstTitle: items[0]?.title,
    firstStatus: items[0]?.listingStatus || items[0]?.status,
  }));
}

const list = await get(token, `/published-listings?storeId=${STORE}&limit=10`);
const items = list.body?.items || list.body?.data || list.body?.listings || [];
const samples = [];
for (const it of items.slice(0, 5)) {
  const d = await get(token, `/stores/${STORE}/listings/published/${it.id}`);
  const b = d.body?.data || d.body?.listing || d.body;
  samples.push({
    id: it.id,
    listTitle: it.title,
    detailTitle: b?.title,
    titleCandidates: {
      title: b?.title,
      titleEn: b?.titleEn,
      englishTitle: b?.englishTitle,
      localizedTitle: b?.localizedTitle,
      marketplaceTitle: b?.marketplaceTitle,
    },
    listingStatus: b?.listingStatus || it.listingStatus,
    ebayItemId: b?.ebayItemId || it.ebayItemId,
    sku: b?.sku || it.sku,
    marketplaceId: b?.marketplaceId,
    brand: b?.brand || b?.itemSpecifics?.Brand,
    make: b?.itemSpecifics?.Make,
    model: b?.itemSpecifics?.Model,
    year: b?.itemSpecifics?.Year,
    compatibleProducts: Array.isArray(b?.compatibleProducts) ? b.compatibleProducts.length : null,
    compatibilityType: typeof b?.compatibility,
    sampleCompat: Array.isArray(b?.compatibleProducts) ? b.compatibleProducts.slice(0, 1) : b?.compatibility,
  });
}
console.log('SAMPLES', JSON.stringify(samples, null, 2));
