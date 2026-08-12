#!/usr/bin/env node
const https = require('https');
const data = JSON.stringify({ partId: '0a4583af-44cd-44bc-a459-4cd17f2df80d' });
const req = https.request({
  hostname: 'partsbazar360.com',
  path: '/buyer/api/revalidate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-revalidate-secret': '0ef6bcfb592dc55d127245076ca3f5881244168fe612a95f',
    'Content-Length': data.length
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log(body));
});
req.write(data);
req.end();
