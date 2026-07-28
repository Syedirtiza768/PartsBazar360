async function main() {
  const authRes = await fetch('https://mhn.realtrackapp.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.REALTRACK_API_EMAIL, password: process.env.REALTRACK_API_PASSWORD })
  });
  const { accessToken } = await authRes.json();
  console.log('Authenticated');
  
  const res = await fetch('https://mhn.realtrackapp.com/api/published-listings?page=1&limit=5&storeId=3b84b063-3811-481f-a61d-f7846a03558f', {
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  console.log('Total:', data.total, 'Items:', data.items?.length);
  console.log('First title:', data.items?.[0]?.title?.substring(0, 80));
  console.log('Has titleEn?', typeof data.items?.[0]?.titleEn);
}
main().catch(e => console.error('Error:', e.message));
