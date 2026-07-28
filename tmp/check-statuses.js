async function main() {
  const authRes = await fetch('https://mhn.realtrackapp.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.REALTRACK_API_EMAIL, password: process.env.REALTRACK_API_PASSWORD })
  });
  const { accessToken } = await authRes.json();
  
  // Check first few pages for status and quantity
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`https://mhn.realtrackapp.com/api/published-listings?page=${page}&limit=200&storeId=3b84b063-3811-481f-a61d-f7846a03558f`, {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    const data = await res.json();
    
    const statuses = {};
    let zeroQty = 0;
    for (const item of data.items) {
      statuses[item.listingStatus] = (statuses[item.listingStatus] || 0) + 1;
      if (item.quantityAvailable === 0) zeroQty++;
    }
    console.log(`Page ${page}: ${data.items.length} items, statuses:`, statuses, `zeroQty: ${zeroQty}`);
  }
}
main().catch(e => console.error('Error:', e.message));
