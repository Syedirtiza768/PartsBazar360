const { RealTrackService } = require('./dist/src/modules/integration/realtrack.service');

async function tryFetch(path, token) {
  const res = await fetch(`https://mhn.realtrackapp.com/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  console.log('\n', path, res.status, text.slice(0, 400));
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  const svc = new RealTrackService();
  await svc.authenticate();
  const token = svc.accessToken;

  const list = await svc.fetchListings({ page: 1, limit: 1, search: '65125A41CD8' });
  const item = list.items[0];
  if (!item) return console.log('no item');
  console.log('listing id', item.id, 'ebay', item.ebayItemId, 'store', item.storeId);

  const paths = [
    `/published-listings/${item.id}`,
    `/published-listings/${item.id}/details`,
    `/published-listings/${item.id}/compatibility`,
    `/published-listings/${item.id}/images`,
    `/stores/${item.storeId}/listings/published/${item.id}`,
    `/ebay/items/${item.ebayItemId}`,
    `/items/${item.ebayItemId}`,
  ];

  for (const p of paths) {
    await tryFetch(p, token);
  }
}

main().catch(console.error);
