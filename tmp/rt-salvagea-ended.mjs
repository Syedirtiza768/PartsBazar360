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
  if (!r.ok) throw new Error('auth fail');
  return j.accessToken;
}
async function get(token, path) {
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: r.status, body: await r.json() };
}

const token = await login();
const storeId = '3b84b063-3811-481f-a61d-f7846a03558f';
const list = await get(token, `/published-listings?page=1&limit=3&storeId=${storeId}&status=ended`);
const out = { listTotal: list.body?.total, items: [] };
for (const item of list.body?.items || []) {
  const d = await get(token, `/stores/${storeId}/listings/published/${item.id}`);
  const full = { ...item, ...(d.body || {}) };
  out.items.push({
    id: full.id,
    title: full.title,
    listingStatus: full.listingStatus,
    qty: full.quantityAvailable,
    imageCount: (full.imageUrls || []).length,
    ebayImages: (full.imageUrls || []).filter((u) => /ebay/i.test(u)).length,
    hasDescription: !!(full.description && String(full.description).trim()),
    descriptionLen: full.description ? String(full.description).length : 0,
    compat: full.compatibility,
    itemSpecifics: full.itemSpecifics,
    condition: full.condition,
    lastSyncedAt: full.lastSyncedAt,
    ebayEndTime: full.ebayEndTime,
    sampleImages: (full.imageUrls || []).slice(0, 3),
  });
}
console.log(JSON.stringify(out, null, 2));
