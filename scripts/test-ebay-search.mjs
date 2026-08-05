import axios from 'axios';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadDotEnv('F:\\apps\\realtrackapp\\.env');

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_BASE = 'https://api.ebay.com';

const creds = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
const { data: tokenData } = await axios.post(
  `${EBAY_BASE}/identity/v1/oauth2/token`,
  new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }).toString(),
  { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } },
);
const token = tokenData.access_token;
console.log('Got token');

const testQueries = [
  'TTC 07.19.377',
  '07.19.377',
  '34211166127',
  '99610612554',
  'FEBEST 03606-005',
  'TEXTAR 92123103',
  'Mercedes thermostat 6512002800',
  '7L0412137',
];

for (const q of testQueries) {
  try {
    const { data } = await axios.get(`${EBAY_BASE}/buy/browse/v1/item_summary/search`, {
      params: { q, limit: 3, filter: 'buyingOptions:{FIXED_PRICE}' },
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', Accept: 'application/json' },
      timeout: 15000,
    });
    const items = data.itemSummaries ?? [];
    console.log(`"${q}" => ${data.total} results, ${items.length} returned, image: ${items[0]?.image?.imageUrl ?? 'NONE'}`);
  } catch (err) {
    console.log(`"${q}" => ERROR: ${err.response?.status} ${err.message}`);
  }
}
