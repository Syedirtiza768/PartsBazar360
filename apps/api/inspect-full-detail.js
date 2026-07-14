const { RealTrackService } = require('./dist/src/modules/integration/realtrack.service');

async function main() {
  const svc = new RealTrackService();
  await svc.authenticate();
  const token = svc.accessToken;

  // Prefer a listing that already has gridx multi-images if possible
  const list = await svc.fetchListings({ page: 1, limit: 20 });
  let item = list.items.find((i) => (i.imageUrls || []).some((u) => u.includes('gridxconnect'))) || list.items[0];

  // Also specifically fetch the Mini Cooper listing the user asked about
  const mini = await svc.fetchListings({ page: 1, limit: 5, search: '65125A41CD8' });
  if (mini.items[0]) item = mini.items[0];

  console.log('using listing', item.id, item.title);

  const res = await fetch(`https://mhn.realtrackapp.com/api/published-listings/${item.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const full = await res.json();
  console.log('status', res.status);
  console.log(JSON.stringify(full, null, 2).slice(0, 15000));
  console.log('\n--- KEYS ---', Object.keys(full).sort().join(', '));
  console.log('imageUrls', full.imageUrls);
  console.log('compatibility', full.compatibility);
  console.log('itemSpecifics', full.itemSpecifics);
  console.log('rawEbayResponse keys', full.rawEbayResponse ? Object.keys(full.rawEbayResponse) : null);
  if (full.rawEbayResponse) console.log('rawEbayResponse', JSON.stringify(full.rawEbayResponse, null, 2).slice(0, 5000));
}

main().catch(console.error);
