async function main() {
  const authRes = await fetch('https://mhn.realtrackapp.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.REALTRACK_API_EMAIL, password: process.env.REALTRACK_API_PASSWORD })
  });
  const { accessToken } = await authRes.json();
  
  const res = await fetch('https://mhn.realtrackapp.com/api/published-listings?page=1&limit=2&storeId=3b84b063-3811-481f-a61d-f7846a03558f', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const data = await res.json();
  console.log('Summary fields:', Object.keys(data.items[0]));
  console.log('---');
  console.log('First item:', JSON.stringify(data.items[0], null, 2));
}
main().catch(e => console.error('Error:', e.message));
