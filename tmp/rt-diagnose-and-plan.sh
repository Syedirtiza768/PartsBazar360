#!/bin/bash
set -euo pipefail
cd /home/ubuntu/PartsBazar360
CID=$(sudo docker compose ps -q api)

echo "=== GIT ==="
git rev-parse --short HEAD
git log -1 --oneline

echo "=== REALTRACK ENV ==="
sudo docker exec "$CID" sh -c 'echo URL=$REALTRACK_API_URL; echo EMAIL=$REALTRACK_API_EMAIL; echo PASS_LEN=${#REALTRACK_API_PASSWORD}; echo MANIFEST_SET=$([ -n "$REALTRACK_STORE_MANIFEST_JSON" ] && echo yes || echo no)'

cat > /tmp/rt-diag.mjs <<'EOF'
const base = (process.env.REALTRACK_API_URL || 'https://mhn.realtrackapp.com/api').replace(/\/$/, '');
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
  return { token: j.accessToken, loginBodyKeys: Object.keys(j) };
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

const { token } = await login();
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
  '/published-listings?page=1&limit=5&status=active',
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
    message: b?.message || b?.error,
    sampleStoreId: b?.items?.[0]?.storeId,
    sampleTitle: b?.items?.[0]?.title?.slice?.(0, 60),
    userRole: b?.user?.roleSlug,
    permissions: b?.user?.permissions,
    orgs: b?.organizations?.map((o) => o.name || o.slug),
    bodyType: typeof b,
    topKeys: b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b).slice(0, 12) : undefined,
  });
}

console.log(JSON.stringify({ base, email, results }, null, 2));
EOF

sudo docker cp /tmp/rt-diag.mjs "$CID":/tmp/rt-diag.mjs
sudo docker exec -w /app "$CID" node /tmp/rt-diag.mjs
