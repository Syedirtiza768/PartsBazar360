#!/usr/bin/env node

/**
 * Small cost/quality pilot for multi-listing image lookup in one OpenRouter call.
 *
 * This is intentionally separate from the production enrichment script so we can
 * measure whether batching actually reduces cost before changing the main flow.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadDotEnv(resolve('.env'));
loadDotEnv(resolve('apps/api/.env'));

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const INPUT = opt('input', 'outputs/superior_AAP_pending_image_rows.csv');
const OUTPUT = opt('output', 'outputs/superior_AAP_pending_image_rows-gpt5-fetch-batch-pilot.json');
const LIMIT = Number(opt('limit', '5')) || 5;
const MODEL = opt('model', 'openai/gpt-5.2');
const SEARCH_ENGINE = opt('search-engine', 'native');
const FETCH_ENGINE = opt('fetch-engine', 'openrouter');
const CANDIDATE_LIMIT = Math.max(1, Number(opt('candidate-limit', '8')) || 8);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY in environment.');
  process.exit(1);
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  const header = rows.shift() || [];
  return { header, rows };
}

function headerIndex(header) {
  const idx = {};
  header.forEach((h, i) => {
    idx[h.trim()] = i;
  });
  return idx;
}

function cell(row, idx, name) {
  const i = idx[name];
  return i == null ? '' : String(row[i] ?? '').trim();
}

function cleanPartNumber(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function rowToListing(row, idx) {
  return {
    listing_id: cell(row, idx, 'listing_id'),
    title: cell(row, idx, 'title'),
    brand: cell(row, idx, 'brand'),
    manufacturer: cell(row, idx, 'manufacturer'),
    mfr_part_number: cleanPartNumber(cell(row, idx, 'mfr_part_number')),
    genuine_oem_part_number: cleanPartNumber(cell(row, idx, 'genuine_oem_part_number')),
    oe_numbers: cell(row, idx, 'oe_numbers'),
    category: cell(row, idx, 'category'),
    category_group: cell(row, idx, 'category_group'),
    part_type: cell(row, idx, 'part_type'),
    condition: cell(row, idx, 'condition'),
    seller_sku: cleanPartNumber(cell(row, idx, 'seller_sku')),
    description: cell(row, idx, 'description').slice(0, 1000),
    item_specifics_json: cell(row, idx, 'item_specifics_json').slice(0, 2000),
  };
}

function extractJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(content.slice(first, last + 1));
    throw new Error(`Could not parse JSON: ${content.slice(0, 500)}`);
  }
}

async function validateImageUrl(url) {
  if (!url || /\.svg(?:$|[?#])/i.test(url)) return { ok: false, reason: 'empty/svg' };
  for (const method of ['HEAD', 'GET']) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'PartsBazar360 image enrichment (+https://partsbazar360.com)',
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });
      clearTimeout(timeout);
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && type.startsWith('image/') && !type.includes('svg')) {
        return { ok: true, reason: `${res.status} ${type}` };
      }
      if (method === 'GET') return { ok: false, reason: `HTTP ${res.status}; ${type || 'unknown type'}` };
    } catch (error) {
      if (method === 'GET') return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, reason: 'not validated' };
}

const { header, rows } = parseCSV(readFileSync(INPUT, 'utf8'));
const idx = headerIndex(header);
const listings = rows.slice(0, LIMIT).map((row) => rowToListing(row, idx));

const messages = [
  {
    role: 'system',
    content:
      'You are a cautious auto-parts image research assistant. Find direct product image URLs only when each URL really belongs to the exact requested listing. Reject uncertain, generic, vehicle-only, logo, placeholder, SVG, or invented URLs. Return only JSON.',
  },
  {
    role: 'user',
    content: JSON.stringify(
      {
        task:
          'For each listing, search/fetch the web and return an item in results with listing_id, status ("matched"|"no_confident_match"), imageUrl, sourceUrl, source, query, confidence, reason. Use source pages and exact part numbers where possible. Do not invent CDN paths.',
        listings,
      },
      null,
      2,
    ),
  },
];

const startedAt = new Date().toISOString();
const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://partsbazar360.com',
    'X-Title': 'PartsBazar360 AI image batch cost pilot',
  },
  body: JSON.stringify({
    model: MODEL,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
    tools: [
      {
        type: 'openrouter:web_search',
        parameters: {
          engine: SEARCH_ENGINE,
          max_results: Math.min(CANDIDATE_LIMIT, 10),
          max_total_results: CANDIDATE_LIMIT * LIMIT,
          search_context_size: 'low',
        },
      },
      {
        type: 'openrouter:web_fetch',
        parameters: {
          engine: FETCH_ENGINE,
          max_uses: Math.max(3, LIMIT * 2),
          max_content_tokens: 12000,
        },
      },
    ],
  }),
});

const body = await res.text();
if (!res.ok) {
  writeFileSync(OUTPUT, JSON.stringify({ startedAt, ok: false, status: res.status, body }, null, 2));
  throw new Error(`OpenRouter ${res.status}: ${body}`);
}

const data = JSON.parse(body);
const content = data.choices?.[0]?.message?.content || '';
const parsed = extractJson(content);
const results = Array.isArray(parsed.results) ? parsed.results : [];

for (const result of results) {
  if (result.status === 'matched') {
    const validation = await validateImageUrl(result.imageUrl);
    result.validation = validation;
    if (!validation.ok) result.status = 'no_confident_match';
  }
}

const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  model: MODEL,
  limit: LIMIT,
  returned: results.length,
  matched: results.filter((r) => r.status === 'matched').length,
  no_confident: results.filter((r) => r.status !== 'matched').length,
  usage: data.usage || null,
  results,
};

writeFileSync(OUTPUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
