#!/usr/bin/env node

/**
 * Fill missing images for active GEN listings using GPT-5.6 Luna web search.
 *
 * This script changes only imageUrls/ProductMedia. It accepts a result only
 * when the model's source/evidence identifies the exact brand and MPN and the
 * returned URL responds as an image. Existing seller images are preserved.
 */
import fs from 'node:fs/promises';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';

const MODEL = process.env.IMAGE_WEB_MODEL || 'openai/gpt-5.6-luna';
const CONCURRENCY = Math.max(1, Number(process.env.IMAGE_WEB_CONCURRENCY || 4));
const DELAY_MS = Math.max(0, Number(process.env.IMAGE_WEB_DELAY_MS || 250));
const LIMIT = readNumberArg('--limit');
const OFFSET = readNumberArg('--offset') || 0;
const DRY_RUN = process.env.IMAGE_WEB_DRY_RUN === '1';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SOURCE = process.env.IMAGE_WEB_SOURCE || 'gpt-5.6-luna:web-image-v1';
const BACKUP_PATH = process.env.IMAGE_WEB_BACKUP_PATH || '/tmp/gen-web-image-backup.jsonl';
const REPORT_PATH = process.env.IMAGE_WEB_REPORT_PATH || '/tmp/gen-web-image-report.jsonl';
const USER_AGENT =
  'PartsBazar360/1.0 (+https://partsbazar360.com; exact automotive catalog image lookup)';

function readNumberArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    url.hash = '';
    return url.toString();
  } catch {
    return String(value || '').trim();
  }
}

function isImageUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) && !/\.svg(?:[?#]|$)/i.test(url);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function getBrand(part) {
  const brand = cleanText(part.brand);
  return brand && !/^unknown$/i.test(brand) ? brand : '';
}

function getMpn(part) {
  if (part.manufacturerPartNumber) return cleanText(part.manufacturerPartNumber);
  const oe = Array.isArray(part.oeNumbers) ? part.oeNumbers.find(Boolean) : null;
  return oe ? cleanText(oe) : '';
}

function parseJson(content) {
  const cleaned = String(content || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('web model returned no JSON object');
  return JSON.parse(match[0]);
}

async function validateImageUrl(imageUrl) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' };
  try {
    const head = await fetch(imageUrl, { method: 'HEAD', headers, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    const contentType = String(head.headers.get('content-type') || '').toLowerCase();
    if (head.ok && contentType.startsWith('image/')) return { status: 'valid', contentType };
  } catch {
    // Some image CDNs reject HEAD; retry with a small ranged GET below.
  }

  try {
    const response = await fetch(imageUrl, {
      headers: { ...headers, Range: 'bytes=0-2047' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (response.ok && contentType.startsWith('image/')) {
      await response.body?.cancel();
      return { status: 'valid', contentType };
    }
  } catch {
    // The caller records the rejection without making a catalog write.
  }
  return { status: 'invalid_image' };
}

async function lookupWithWeb(part) {
  const brand = getBrand(part);
  const mpn = getMpn(part);
  if (!brand || !mpn) return { status: 'missing_evidence' };
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY is required');

  const prompt = `Find one product image for this exact aftermarket automotive part:
Brand: ${brand}
Manufacturer part number: ${mpn}
Part title: ${part.title}
Category: ${part.category || part.partType || 'automotive part'}

Use web search. Return ONLY one compact JSON object:
{"imageUrl":"https://... or null","sourceUrl":"https://... or null","evidence":"brief exact-match evidence"}

Rules:
- Return an image only if the source clearly identifies BOTH the exact brand and exact part number.
- Do not use a generic category image, a vehicle photo, another brand, or a similar part number.
- The image URL must be the product image itself, not a search-engine thumbnail or page URL.
- If no exact product source exists, return null values.`;

  const requestBody = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are a strict automotive product-image researcher. Never invent URLs.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    max_tokens: 900,
    plugins: [{ id: 'web' }],
  });
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://partsbazar360.com',
          'X-Title': 'PartsBazar360 exact GEN image lookup',
        },
        body: requestBody,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(5_000 * (attempt + 1));
      continue;
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 10_000 * (attempt + 1));
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 300)}`);
  const data = JSON.parse(body);
  const message = data.choices?.[0]?.message;
  const result = parseJson(message?.content || '');
  const imageUrl = normalizeUrl(result.imageUrl);
  const sourceUrl = normalizeUrl(result.sourceUrl);
  const exactEvidence = normalizeToken(`${brand} ${mpn} ${sourceUrl} ${result.evidence || ''}`);
  const nBrand = normalizeToken(brand);
  const nMpn = normalizeToken(mpn);

  if (!isImageUrl(imageUrl) || !sourceUrl || !exactEvidence.includes(nBrand) || !exactEvidence.includes(nMpn)) {
    return { status: 'rejected_evidence', usage: data.usage || null };
  }
  const validation = await validateImageUrl(imageUrl);
  if (validation.status !== 'valid') return { status: 'invalid_image', usage: data.usage || null };
  return {
    status: 'matched',
    imageUrl,
    sourceUrl,
    evidence: cleanText(result.evidence),
    contentType: validation.contentType,
    usage: data.usage || null,
  };
}

async function upsertImage(client, part, match) {
  await client.query('BEGIN');
  try {
    const updated = await client.query(
      `UPDATE "CanonicalPart"
       SET "imageUrls"=$2::text[], "updatedAt"=now()
       WHERE id=$1 AND COALESCE(array_length("imageUrls",1),0)=0
       RETURNING id`,
      [part.id, [match.imageUrl]],
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO "ProductMedia"
        (id, "canonicalPartId", url, "normalizedUrl", "sortOrder", "isPrimary", "isActualItem", "mediaType", "importStatus", "altText", "sourceUrl", "createdAt")
       VALUES ($1,$2,$3,$3,0,true,false,'IMAGE','IMPORTED',$4,$5,now())
       ON CONFLICT ("canonicalPartId", "normalizedUrl") DO UPDATE SET
         "isPrimary"=true, "isActualItem"=false, "altText"=EXCLUDED."altText", "sourceUrl"=EXCLUDED."sourceUrl"`,
      [
        randomUUID(),
        part.id,
        match.imageUrl,
        `Product image for exact ${part.brand} ${part.manufacturerPartNumber} match`,
        match.sourceUrl,
      ],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function fetchParts(client) {
  const limitSql = LIMIT == null ? '' : `LIMIT ${Math.max(0, LIMIT)}`;
  const offsetSql = OFFSET ? `OFFSET ${Math.max(0, OFFSET)}` : '';
  const result = await client.query(`
    SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber", cp."oeNumbers", cp.category, cp."partType", cp."imageUrls"
    FROM "CanonicalPart" cp
    JOIN LATERAL (
      SELECT 1
      FROM "SellerOffer"
      WHERE "canonicalPartId"=cp.id AND "sourceTag"='GEN' AND status='ACTIVE'
      LIMIT 1
    ) so ON TRUE
    WHERE COALESCE(array_length(cp."imageUrls",1),0)=0
    ORDER BY cp.id
    ${limitSql} ${offsetSql}`);
  return result.rows;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!OPENROUTER_KEY && !DRY_RUN) throw new Error('OPENROUTER_API_KEY is required');
  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const parts = await fetchParts(client);
    await fs.writeFile(BACKUP_PATH, `${parts.map((part) => JSON.stringify(part)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'start', model: MODEL, source: SOURCE, total: parts.length, concurrency: CONCURRENCY, dryRun: DRY_RUN, backupPath: BACKUP_PATH, reportPath: REPORT_PATH }));

    const results = [];
    let cursor = 0;
    let completed = 0;
    let imageUpdated = 0;
    let failed = 0;

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= parts.length) return;
        const part = parts[index];
        const row = { id: part.id, title: part.title, brand: part.brand, mpn: part.manufacturerPartNumber, status: 'started' };
        try {
          const match = await lookupWithWeb(part);
          row.imageStatus = match.status;
          row.imageUrl = match.imageUrl || null;
          row.sourceUrl = match.sourceUrl || null;
          row.evidence = match.evidence || null;
          row.usage = match.usage || null;
          if (!DRY_RUN && match.status === 'matched') {
            row.imageAdded = await upsertImage(client, part, match);
            if (row.imageAdded) imageUpdated++;
          }
          row.status = DRY_RUN ? 'dry_run' : 'checked';
        } catch (error) {
          failed++;
          row.status = 'failed';
          row.error = error?.message || String(error);
        }
        results.push(row);
        completed++;
        if (completed % 10 === 0 || completed === parts.length) {
          console.log(JSON.stringify({ event: 'progress', completed, total: parts.length, imageUpdated, failed }));
        }
        if (DELAY_MS) await sleep(DELAY_MS);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, parts.length)) }, worker));
    await fs.writeFile(REPORT_PATH, `${results.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'done', total: parts.length, imageUpdated, failed, source: SOURCE, backupPath: BACKUP_PATH, reportPath: REPORT_PATH }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
