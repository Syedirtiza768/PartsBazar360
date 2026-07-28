/** Sample SalvageA titles + compatibility from RealTrack. */
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
  return { status: r.status, body: await r.json() };
}

const token = await login();
const list = await get(token, `/published-listings?storeId=${STORE}&limit=20&status=ACTIVE`);
const items = list.body?.items || list.body?.data || list.body?.listings || [];
console.log('listStatus', list.status, 'total', list.body?.total, 'sample', items.length);

const samples = [];
for (const it of items.slice(0, 8)) {
  const d = await get(token, `/stores/${STORE}/listings/published/${it.id}`);
  const b = d.body?.data || d.body?.listing || d.body;
  samples.push({
    id: it.id,
    listTitle: it.title,
    detailTitle: b?.title,
    titleEn: b?.titleEn || b?.titleEnglish || b?.englishTitle,
    locale: b?.locale || b?.language || b?.marketplaceLanguage,
    marketplaceId: b?.marketplaceId,
    ebayItemId: b?.ebayItemId,
    sku: b?.sku,
    brand: b?.brand || b?.itemSpecifics?.Brand,
    mpn: b?.mpn,
    compatLen: Array.isArray(b?.compatibleProducts) ? b.compatibleProducts.length : null,
    compatRaw: b?.compatibility,
    itemSpecificsKeys: b?.itemSpecifics ? Object.keys(b.itemSpecifics).slice(0, 20) : [],
    year: b?.itemSpecifics?.Year,
    make: b?.itemSpecifics?.Make,
    model: b?.itemSpecifics?.Model,
  });
}
console.log(JSON.stringify(samples, null, 2));
