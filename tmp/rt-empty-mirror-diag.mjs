/**
 * Deep diagnosis: why RealTrack published-listings mirror is empty.
 */
const base = (process.env.REALTRACK_API_URL || '').replace(/\/$/, '');
const email = process.env.REALTRACK_API_EMAIL;
const password = process.env.REALTRACK_API_PASSWORD;

const DOC_STORES = [
  ['79f249a5-31e0-42a8-978c-a99b0665c61b', 'All About Mercedes'],
  ['fa528c8a-f249-4816-94f6-f2ce8b932449', 'B.JLRWORLD'],
  ['d16199c4-55b5-429e-ad27-892bed94e00d', 'BLACKLINEAUTOPARTS'],
  ['5fc75f19-31f3-44e4-b1ae-6545055f7945', 'K. Brit Auto Depot - UK'],
  ['65aff8ec-21ee-460f-af17-20daa0b843c1', 'K. Euro Japan Auto Parts'],
  ['eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0', 'K. Salvage Auto Parts'],
  ['cc658cc0-ab21-4519-9f06-4aea8ff6a809', 'K. Salvage Dismantlers - DE'],
  ['7658e52e-4dd6-48a7-ad78-6933630bdac7', 'K. Southern Cross Auto Parts - AU'],
  ['cfcc4a9c-c41b-4166-ab41-989c00a6fad1', 'Primemotive'],
  ['8d7d8b23-d769-4ed5-91e2-e26d14a45215', 'VW & RR'],
  ['70ad5c44-6424-4998-815c-99adf28c2487', 'eBay store'],
  ['3b84b063-3811-481f-a61d-f7846a03558f', 'US SalvageA (marketplace config)'],
];

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function login() {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${r.status} ${JSON.stringify(j)}`);
  return j;
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
    body = { raw: text.slice(0, 400) };
  }
  return { status: r.status, body };
}

const loginBody = await login();
const token = loginBody.accessToken;
const jwt = decodeJwt(token);
const me = await get(token, '/auth/me');

const globalList = await get(token, '/published-listings?page=1&limit=1');
const storeRoute = await get(
  token,
  `/stores/eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0/listings/published?page=1&limit=1`,
);
const blacklineRoute = await get(
  token,
  `/stores/d16199c4-55b5-429e-ad27-892bed94e00d/listings/published?page=1&limit=1`,
);
const salvageARoute = await get(
  token,
  `/stores/3b84b063-3811-481f-a61d-f7846a03558f/listings/published?page=1&limit=1`,
);

const perStore = [];
for (const [storeId, name] of DOC_STORES) {
  const a = await get(token, `/published-listings?page=1&limit=1&storeId=${storeId}`);
  const b = await get(token, `/stores/${storeId}/listings/published?page=1&limit=1`);
  perStore.push({
    storeId,
    name,
    listTotal: a.body?.total ?? null,
    listStatus: a.status,
    storeRouteTotal: b.body?.total ?? null,
    storeRouteStatus: b.status,
    storeRouteMessage: b.body?.message || b.body?.error || null,
  });
}

// Alternate filters that sometimes bypass soft-delete / status defaults
const altFilters = [];
for (const q of [
  'status=active',
  'status=ACTIVE',
  'status=PUBLISHED',
  'status=published',
  'marketplaceId=EBAY_MOTORS_US',
  'marketplaceId=EBAY_US',
  'marketplaceId=0',
  'includeEnded=true',
  'includeInactive=true',
  'all=true',
  'search=OEM',
  'sku=test',
]) {
  const res = await get(token, `/published-listings?page=1&limit=1&${q}`);
  altFilters.push({
    q,
    status: res.status,
    total: res.body?.total ?? null,
    message: res.body?.message || null,
  });
}

console.log(
  JSON.stringify(
    {
      diagnosedAt: new Date().toISOString(),
      base,
      email,
      loginUser: {
        id: loginBody.user?.id,
        email: loginBody.user?.email,
        role: loginBody.user?.role,
      },
      jwtClaims: jwt
        ? {
            sub: jwt.sub,
            exp: jwt.exp,
            iat: jwt.iat,
            orgId: jwt.orgId || jwt.organizationId || jwt.organization_id,
            storeAccessAll: jwt.storeAccessAll,
            permissions: jwt.permissions,
            role: jwt.role || jwt.roleSlug,
            keys: Object.keys(jwt),
          }
        : null,
      authMe: me.body,
      globalList: {
        status: globalList.status,
        total: globalList.body?.total,
        items: globalList.body?.items?.length,
      },
      storeScopedRoutes: {
        kSalvage: { status: storeRoute.status, total: storeRoute.body?.total, message: storeRoute.body?.message },
        blackline: {
          status: blacklineRoute.status,
          total: blacklineRoute.body?.total,
          message: blacklineRoute.body?.message,
        },
        salvageA: {
          status: salvageARoute.status,
          total: salvageARoute.body?.total,
          message: salvageARoute.body?.message,
        },
      },
      perStore,
      altFilters,
      hypothesis: [
        'If all totals are 0 with 200: ebay_published_listings table/view empty or sync job stopped',
        'If 403/empty only for some stores: store access scope narrowed despite storeAccessAll claim in docs',
        'If store routes 404 for SalvageA: store not in org / not connected',
        'Contract baseline was total=314076 — current total=0 is a RealTrack-side regression',
      ],
    },
    null,
    2,
  ),
);
