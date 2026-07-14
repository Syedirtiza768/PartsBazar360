const { RealTrackService } = require('./dist/src/modules/integration/realtrack.service');

async function main() {
  const svc = new RealTrackService();
  // Fetch by ebay item search / general listings and find a rich one
  const result = await svc.fetchListings({ page: 1, limit: 5, search: '65125A41CD8' });
  console.log('total:', result.total, 'items:', result.items.length);
  for (const item of result.items) {
    console.log('\n=== LISTING ===');
    console.log('id:', item.id);
    console.log('title:', item.title);
    console.log('ebayItemId:', item.ebayItemId);
    console.log('imageUrls count:', (item.imageUrls || []).length);
    console.log('imageUrls:', JSON.stringify(item.imageUrls, null, 2));
    console.log('compatibility type:', typeof item.compatibility, Array.isArray(item.compatibility));
    console.log('compatibility:', JSON.stringify(item.compatibility, null, 2)?.slice(0, 2000));
    console.log('keys:', Object.keys(item).sort().join(', '));
    // dump any nested objects that might hold more media/fitment
    for (const key of Object.keys(item)) {
      const val = item[key];
      if (val && typeof val === 'object') {
        const s = JSON.stringify(val);
        if (s.length > 80 && !['imageUrls', 'healthFlags'].includes(key)) {
          console.log(`nested ${key}:`, s.slice(0, 500));
        }
      }
    }
  }

  // Also try a generic sample
  const sample = await svc.fetchListings({ page: 1, limit: 3 });
  for (const item of sample.items) {
    console.log('\n=== SAMPLE ===');
    console.log('title:', item.title);
    console.log('images:', (item.imageUrls || []).length, JSON.stringify(item.imageUrls));
    console.log('compatibility:', JSON.stringify(item.compatibility)?.slice(0, 300));
    console.log('keys:', Object.keys(item).sort().join(', '));
  }
}

main().catch(console.error);
