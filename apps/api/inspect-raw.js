const { RealTrackService } = require('./dist/src/modules/integration/realtrack.service');

async function main() {
  const svc = new RealTrackService();
  const result = await svc.fetchListings({ page: 1, limit: 5, search: '65125A41CD8' });
  const item = result.items[0];
  if (!item) {
    console.log('no item');
    return;
  }

  console.log('=== TOP LEVEL ===');
  console.log(JSON.stringify({
    id: item.id,
    title: item.title,
    imageUrls: item.imageUrls,
    compatibility: item.compatibility,
    itemSpecifics: item.itemSpecifics,
    description: typeof item.description === 'string' ? item.description.slice(0, 500) : item.description,
  }, null, 2));

  console.log('\n=== rawEbayResponse FULL ===');
  console.log(JSON.stringify(item.rawEbayResponse, null, 2));

  // Find a listing with multi images if possible by scanning a few pages
  for (let page = 1; page <= 3; page++) {
    const pageResult = await svc.fetchListings({ page, limit: 50 });
    for (const listing of pageResult.items) {
      const imgs = listing.imageUrls || [];
      const raw = listing.rawEbayResponse;
      const rawImgs = [];
      if (raw) {
        const s = JSON.stringify(raw);
        const matches = s.match(/https?:\/\/[^"\\]+\.(?:jpg|jpeg|png|webp)/gi) || [];
        rawImgs.push(...matches);
      }
      if (imgs.length > 1 || rawImgs.length > 1 || listing.compatibility || listing.itemSpecifics) {
        console.log('\n=== RICH LISTING FOUND ===');
        console.log('title:', listing.title);
        console.log('imageUrls:', JSON.stringify(listing.imageUrls));
        console.log('compatibility:', JSON.stringify(listing.compatibility)?.slice(0, 500));
        console.log('itemSpecifics:', JSON.stringify(listing.itemSpecifics)?.slice(0, 1000));
        console.log('raw image urls found:', [...new Set(rawImgs)].slice(0, 20));
        console.log('raw keys:', listing.rawEbayResponse ? Object.keys(listing.rawEbayResponse) : null);
        if (listing.rawEbayResponse?.item) {
          console.log('raw.item keys:', Object.keys(listing.rawEbayResponse.item));
          console.log('raw.item sample:', JSON.stringify(listing.rawEbayResponse.item, null, 2).slice(0, 3000));
        }
        return;
      }
    }
  }
  console.log('No multi-image listing found in first 150 items');
}

main().catch(console.error);
