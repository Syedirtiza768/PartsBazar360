async function main() {
  const authRes = await fetch('https://mhn.realtrackapp.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.REALTRACK_API_EMAIL, password: process.env.REALTRACK_API_PASSWORD })
  });
  const { accessToken } = await authRes.json();
  
  const res = await fetch('https://mhn.realtrackapp.com/api/published-listings?page=1&limit=1&storeId=3b84b063-3811-481f-a61d-f7846a03558f', {
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  console.log(JSON.stringify({ total: data.total, items_in_page: data.items?.length }));
}
main().catch(e => console.error(e.message));
