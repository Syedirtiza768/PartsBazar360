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
  if (!r.ok) throw new Error(`auth ${r.status} ${JSON.stringify(j)}`);
  return j.accessToken;
}

async function get(token, path) {
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: r.status, body };
}

const token = await login();
const probes = [
  '/auth/me',
  '/published-listings?page=1&limit=5',
  '/published-listings?page=1&limit=5&storeId=3b84b063-3811-481f-a61d-f7846a03558f',
  '/published-listings?page=1&limit=5&storeId=eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0',
  '/published-listings?page=1&limit=5&storeSlug=salvagea',
  '/published-listings?page=1&limit=5&storeId=d16199c4-55b5-429e-ad27-892bed94e00d',
  '/published-listings?page=1&limit=5&storeSlug=blacklineusedautoparts',
  '/published-listings?page=1&limit=5&search=mercedes',
  '/published-listings?page=1&limit=5&status=ACTIVE',
  '/published-listings?page=1&limit=5&status=PUBLISHED',
  '/published-listings?page=1&limit=5&marketplaceId=0',
  '/published-listings?page=1&limit=5&marketplaceId=1',
  '/stores',
  '/ebay-accounts',
  '/organizations',
];

const results = [];
for (const path of probes) {
  const res = await get(token, path);
  const b = res.body;
  results.push({
    path,
    status: res.status,
    total: b?.total,
    items: Array.isArray(b?.items) ? b.items.length : undefined,
    message: b?.message || b?.error || b?.statusCode,
    sampleStoreId: b?.items?.[0]?.storeId,
    sampleStoreSlug: b?.items?.[0]?.storeSlug,
    sampleTitle: b?.items?.[0]?.title?.slice?.(0, 80),
    sampleKeys: b?.items?.[0] ? Object.keys(b.items[0]).sort() : undefined,
    userRole: b?.user?.roleSlug || b?.roleSlug,
    permissions: b?.user?.permissions || b?.permissions,
    orgs: Array.isArray(b?.organizations)
      ? b.organizations.map((o) => ({ id: o.id, name: o.name || o.slug }))
      : undefined,
    storesSample: Array.isArray(b?.items || b?.data || b?.stores)
      ? (b.items || b.data || b.stores).slice(0, 5).map((s) => ({
          id: s.id || s.storeId,
          name: s.name || s.storeName || s.slug || s.storeSlug,
          slug: s.slug || s.storeSlug,
        }))
      : undefined,
    topKeys: b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b).slice(0, 15) : undefined,
  });
}

console.log(JSON.stringify({ base, results }, null, 2));
