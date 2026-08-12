#!/usr/bin/env node

/** Update buyer-search fields for the active GEN enhancement campaign. */
import { Client as PgClient } from 'pg';

const OS = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
const INDEX = process.env.OPENSEARCH_INDEX || 'canonical_parts';
const BATCH = Math.max(50, Number(process.env.REINDEX_BATCH || 200));
const CAMPAIGN = process.env.REINDEX_SOURCE || 'gpt-5.6-luna:gen-seo-v1';

async function request(path, options = {}) {
  const response = await fetch(`${OS}${path}`, {
    ...options,
    headers: options.body ? { 'content-type': 'application/x-ndjson', ...(options.headers || {}) } : options.headers,
    body: options.body,
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 400)}`);
  return body;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let cursor = '';
  let indexed = 0;
  let failed = 0;

  try {
    while (true) {
      const result = await client.query(
        `SELECT cp.id, cp.title, cp."imageUrls"
         FROM "CanonicalPart" cp
         JOIN "SellerOffer" so ON so."canonicalPartId"=cp.id
         WHERE so."sourceTag"='GEN' AND so.status='ACTIVE'
           AND cp."enrichmentSource" LIKE $1
           AND cp.id > $2
         GROUP BY cp.id, cp.title, cp."imageUrls"
         ORDER BY cp.id
         LIMIT $3`,
        [`${CAMPAIGN}%`, cursor, BATCH],
      );
      if (!result.rows.length) break;
      cursor = result.rows[result.rows.length - 1].id;
      const ndjson = result.rows
        .map((row) => `${JSON.stringify({ update: { _index: INDEX, _id: row.id } })}\n${JSON.stringify({ doc: { title: row.title, imageUrls: row.imageUrls || [] } })}`)
        .join('\n') + '\n';
      const response = await request('/_bulk?refresh=false', { method: 'POST', body: ndjson });
      if (response.errors) {
        for (const item of response.items || []) {
          if (item.update?.error) failed++;
        }
      }
      indexed += result.rows.length - (response.errors ? (response.items || []).filter((item) => item.update?.error).length : 0);
      console.log(JSON.stringify({ event: 'batch', scanned: indexed + failed, indexed, failed }));
    }
    await request(`/${INDEX}/_refresh`, { method: 'POST' });
    console.log(JSON.stringify({ event: 'done', indexed, failed, source: CAMPAIGN }));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
