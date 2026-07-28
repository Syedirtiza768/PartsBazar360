async function main() {
  const authRes = await fetch('https://mhn.realtrackapp.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.REALTRACK_API_EMAIL, password: process.env.REALTRACK_API_PASSWORD })
  });
  const { accessToken } = await authRes.json();
  
  // Get first listing ID from page 1
  const listRes = await fetch('https://mhn.realtrackapp.com/api/published-listings?page=1&limit=3&storeId=3b84b063-3811-481f-a61d-f7846a03558f', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const listData = await listRes.json();
  console.log('Items on page 1:', listData.items?.length);
  
  // Time the detail fetches
  for (const item of listData.items) {
    const start = Date.now();
    const detRes = await fetch(`https://mhn.realtrackapp.com/api/stores/3b84b063-3811-481f-a61d-f7846a03558f/listings/published/${item.id}`, {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    const detData = await detRes.json();
    console.log(`Detail fetch ${item.id}: ${Date.now() - start}ms, status: ${detRes.status}`);
  }
}
main().catch(e => console.error('Error:', e.message));
