const { RealTrackService } = require('./dist/src/modules/integration/realtrack.service');

async function test() {
  const svc = new RealTrackService();
  const result = await svc.fetchListings({ page: 1, limit: 2 });
  
  for (const item of result.items) {
    console.log('ID:', item.id);
    console.log('Title:', item.title);
    console.log('Image URLs:', JSON.stringify(item.imageUrls));
    console.log('---');
  }
}

test().catch(console.error);
