#!/usr/bin/env node

/**
 * Apply exact-match official-brand evidence to Superior Auto Parts rows that
 * currently have no image.
 *
 * The lookup itself is intentionally external to this writer. The connected
 * You.com service produces a JSON feed containing the official result page,
 * page content, and an image URL extracted from that same page. This script
 * verifies the feed again before any database write, then asks Luna to turn
 * only the official evidence into PDP content.
 *
 * Input: JSON object on stdin: { "rows": [{ id, brand, mpn, official: {...} }] }
 * Required environment: DATABASE_URL, OPENROUTER_API_KEY
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';

const MODEL = process.env.OFFICIAL_MODEL || 'openai/gpt-5.6-luna';
const SOURCE = process.env.OFFICIAL_SOURCE || 'you.com:official-brand-recovery-v1';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const USER_AGENT = 'PartsBazar360/1.0 (+https://partsbazar360.com; official catalog recovery)';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value) {
  return text(value).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeUrl(value) {
  try {
    const url = new URL(text(value));
    url.hash = '';
    return url.toString();
  } catch {
    return text(value);
  }
}

function hostAllowed(value, officialDomain) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const domain = text(officialDomain).toLowerCase().replace(/^www\./, '');
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function containsExactPartNumber(value, mpn) {
  const raw = text(value).normalize('NFKC').toUpperCase();
  const clean = normalizeToken(mpn);
  if (!raw || !clean) return false;
  const pattern = clean.split('').join('[^A-Z0-9]*');
  return new RegExp(`(?:^|[^A-Z0-9])${pattern}(?:$|[^A-Z0-9])`, 'i').test(raw)
    || normalizeToken(raw).includes(clean) && !new RegExp(`[A-Z]${clean}`).test(normalizeToken(raw));
}

function containsBrand(value, brand) {
  const raw = normalizeToken(value);
  const wanted = normalizeToken(brand);
  return Boolean(wanted && raw.includes(wanted));
}

function imageUrlsInContent(value) {
  const raw = String(value || '');
  const found = [];
  const markdown = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
  const html = /(?:src|content)=["'](https?:\/\/[^"']+)["']/gi;
  for (const match of raw.matchAll(markdown)) found.push(match[1]);
  for (const match of raw.matchAll(html)) found.push(match[1]);
  return [...new Set(found.map(normalizeUrl).filter(Boolean))];
}

async function validateImageUrl(url) {
  const imageUrl = normalizeUrl(url);
  if (!/^https?:\/\//i.test(imageUrl)) return { status: 'invalid_url' };
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  try {
    const head = await fetch(imageUrl, {
      method: 'HEAD',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = text(head.headers.get('content-type')).toLowerCase();
    if (head.ok && contentType.startsWith('image/')) return { status: 'valid', contentType };
  } catch {}
  try {
    const response = await fetch(imageUrl, {
      headers: { ...headers, Range: 'bytes=0-4095' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = text(response.headers.get('content-type')).toLowerCase();
    await response.body?.cancel();
    if (response.ok && contentType.startsWith('image/')) return { status: 'valid', contentType };
  } catch {}
  return { status: 'invalid_image' };
}

function clip(value, max) {
  const normalized = text(value);
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max - 1).replace(/\s+\S*$/, '').trim()}…`;
}

function parseJson(value) {
  const raw = Array.isArray(value)
    ? value.map((part) => part?.text || '').join('')
    : String(value || '');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Luna returned no JSON object');
  return JSON.parse(match[0]);
}

function buildPrompt(row, official, imageHealth) {
  return `Create one accurate automotive PDP update using the catalog evidence and one exact-match official manufacturer page.

Return ONLY JSON with exactly these keys:
{
  "decision": "APPROVE" or "REVIEW",
  "identityConfidence": "HIGH" or "MEDIUM" or "LOW",
  "imageAssessment": "MATCH" or "MISMATCH" or "UNCERTAIN",
  "imageConfidence": "HIGH" or "MEDIUM" or "LOW",
  "title": "factual title, max 80 characters",
  "description": "SKU-specific factual description, 80-1800 characters",
  "itemSpecifics": {},
  "oeNumbers": [],
  "contradictions": [],
  "reviewReason": "short reason"
}

Rules:
- The official page is authoritative only for facts explicitly present in its supplied content.
- The official page must match the exact manufacturer part number; do not use a nearby or replacement part.
- Use the official image only because it is extracted from this exact result page. Do not invent or substitute an image.
- This is a no-image recovery pass: assess the supplied official image itself. If it is a clear part image tied to this exact official page, mark imageAssessment MATCH with HIGH confidence; do not mark it UNCERTAIN merely because the old listing had no image.
- Never invent fitment, dimensions, material, warranty, performance, included items, OE/cross-reference numbers, or technical specifications.
- Return an OE/cross-reference number only when that exact number is explicitly present in the official page content and is not the manufacturer part number.
- Use official fitment/specification text only when explicitly published in the supplied page content.
- Keep the catalog brand and exact manufacturer part number unchanged.
- Treat the existing title, description, and item specifics as potentially stale catalog input. Correct them when the official page supplies the replacement fact; do not preserve claims such as Genuine OEM, USED, unsupported fitment, or unsupported warranty when the official evidence contradicts them.
- List only unresolved contradictions that remain after the proposed correction. A stale claim that the generated title, description, or specifics directly correct is resolved and must not by itself force REVIEW.
- Do not upgrade aftermarket to genuine OEM without explicit evidence. Set REVIEW only when exact identity, image validity/identity, or a material factual issue remains unresolved.

Catalog evidence:
${JSON.stringify({
  brand: row.brand,
  manufacturer: row.manufacturer,
  manufacturerPartNumber: row.mpn,
  title: row.title,
  category: row.category,
  partSource: row.partSource,
  condition: row.condition,
  existingDescription: clip(row.description, 1200),
  existingItemSpecifics: asObject(row.itemSpecifics),
})}

Official evidence:
${JSON.stringify({
  sourceUrl: official.sourceUrl,
  officialDomain: official.officialDomain,
  pageTitle: official.pageTitle,
  pageDescription: official.pageDescription,
  snippets: official.snippets,
  pageContent: clip(official.pageContent, 24000),
  imageUrl: official.imageUrl,
  imageHealth,
})}`;
}

async function callLuna(row, official, imageHealth) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://partsbazar360.com',
      'X-Title': 'PartsBazar360 Superior official-brand recovery',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a strict automotive catalog reviewer. Use only supplied evidence. Return valid JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(row, official, imageHealth) },
            { type: 'image_url', image_url: { url: official.imageUrl, detail: 'low' } },
          ],
        },
      ],
      temperature: 0.05,
      max_tokens: 2200,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 600)}`);
  const data = JSON.parse(body);
  const message = data.choices?.[0]?.message;
  return { result: parseJson(message?.content || message?.reasoning), usage: data.usage || null };
}

function cleanSpecifics(current, candidate, row, official) {
  const allowed = new Set([
    'partType', 'categoryType', 'position', 'material', 'color', 'features',
    'placementOnVehicle', 'vehicleSystem', 'surfaceFinish', 'detailBullets',
    'searchKeywords', 'productType', 'inferredProductType', 'brandType',
    'condition', 'qualityTier', 'manufacturer', 'manufacturerPartNumber',
    'dimensions', 'fitmentHints', 'compatibilityNote',
  ]);
  const next = { ...asObject(current) };
  for (const [key, value] of Object.entries(asObject(candidate))) {
    if (!allowed.has(key) || value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      const values = value.map(text).filter(Boolean).slice(0, 20);
      if (values.length) next[key] = values;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = typeof value === 'string' ? clip(value, 700) : value;
    }
  }
  next.manufacturer = text(row.manufacturer || row.brand);
  next.manufacturerPartNumber = text(row.mpn);
  next._official = {
    provider: 'you.com',
    sourceUrl: official.sourceUrl,
    officialDomain: official.officialDomain,
    exactPartNumber: text(row.mpn),
    exactMatch: true,
    imageUrl: official.imageUrl,
    checkedAt: new Date().toISOString(),
  };
  next._seo = {
    source: SOURCE,
    decision: 'APPROVE',
    identityConfidence: 'HIGH',
    imageAssessment: 'MATCH',
    imageConfidence: 'HIGH',
    imageHealth: 'valid',
  };
  return next;
}

function verifiedOeNumbers(candidate, pageContent, mpn) {
  const seen = new Set();
  return asArray(candidate).map(text).filter(Boolean).filter((value) => {
    const key = normalizeToken(value);
    if (!key || key === normalizeToken(mpn) || seen.has(key)) return false;
    if (!containsExactPartNumber(pageContent, value)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24);
}

async function applyRow(client, row) {
  const official = asObject(row.official);
  const result = {
    id: text(row.id),
    productUrl: `https://partsbazar360.com/buyer/part/${text(row.id)}/`,
    brand: text(row.brand),
    mpn: text(row.mpn),
    sourceUrl: normalizeUrl(official.sourceUrl),
    status: 'review',
  };
  if (!result.id || !result.mpn || !result.sourceUrl || !official.officialDomain) {
    result.status = 'skipped_invalid_feed';
    return result;
  }
  const pageContent = [official.pageTitle, official.pageDescription, ...(asArray(official.snippets)), official.pageContent].join('\n');
  if (!hostAllowed(result.sourceUrl, official.officialDomain)) {
    result.status = 'skipped_non_official_domain';
    return result;
  }
  if (!containsBrand(pageContent, row.brand) || !containsExactPartNumber(pageContent, row.mpn)) {
    result.status = 'skipped_no_exact_match';
    return result;
  }
  const contentImages = imageUrlsInContent(official.pageContent);
  const imageUrl = normalizeUrl(official.imageUrl);
  // Manufacturer pages commonly serve product media from a first-party CDN.
  // The image must be embedded in the exact official result page; its host
  // does not have to equal the page host.
  if (!imageUrl || !contentImages.includes(imageUrl)) {
    result.status = 'skipped_image_not_tied_to_exact_page';
    return result;
  }
  const imageHealth = await validateImageUrl(imageUrl);
  result.imageHealth = imageHealth;
  if (imageHealth.status !== 'valid') {
    result.status = 'skipped_invalid_official_image';
    return result;
  }

  const current = await client.query(
    `SELECT cp.*, so.condition AS "offerCondition", so."partSource" AS "offerPartSource", so."qualityTier" AS "offerQualityTier"
     FROM "CanonicalPart" cp
     JOIN LATERAL (
       SELECT condition, "partSource", "qualityTier"
       FROM "SellerOffer"
       WHERE "canonicalPartId" = cp.id AND "sellerId" = 'seller-superior-auto-parts' AND status = 'ACTIVE'
       ORDER BY "updatedAt" DESC LIMIT 1
     ) so ON TRUE
     WHERE cp.id = $1
     LIMIT 1`,
    [result.id],
  );
  const part = current.rows[0];
  if (!part) {
    result.status = 'skipped_not_active';
    return result;
  }
  if (asArray(part.imageUrls).some(Boolean)) {
    result.status = 'skipped_already_has_image';
    return result;
  }

  const enrichedRow = {
    ...row,
    brand: text(part.brand || row.brand),
    manufacturer: text(part.manufacturer || part.brand || row.brand),
    mpn: text(part.manufacturerPartNumber || row.mpn),
    title: part.title,
    category: part.category,
    partSource: part.offerPartSource || part.partSource,
    condition: part.offerCondition || part.qualityTier,
    description: part.description,
    itemSpecifics: asObject(part.itemSpecifics),
  };
  if (normalizeToken(enrichedRow.mpn) !== normalizeToken(row.mpn)) {
    result.status = 'skipped_catalog_mpn_changed';
    return result;
  }

  const { result: generated, usage } = await callLuna(enrichedRow, { ...official, imageUrl }, imageHealth);
  result.luna = generated;
  result.usage = usage;
  const approved = String(generated?.decision || '').toUpperCase() === 'APPROVE'
    && String(generated?.identityConfidence || '').toUpperCase() === 'HIGH'
    && String(generated?.imageAssessment || '').toUpperCase() === 'MATCH'
    && String(generated?.imageConfidence || '').toUpperCase() === 'HIGH'
    && asArray(generated?.contradictions).filter(Boolean).length === 0;
  if (!approved) {
    result.status = 'review_luna_gate';
    result.reviewReason = text(generated?.reviewReason) || 'Luna did not approve the exact official evidence.';
    return result;
  }

  const specifics = cleanSpecifics(part.itemSpecifics, generated.itemSpecifics, enrichedRow, { ...official, imageUrl });
  const title = clip(generated.title || part.title, 80);
  const description = clip(generated.description || part.description || title, 1800);
  const officialOe = verifiedOeNumbers(generated.oeNumbers, pageContent, enrichedRow.mpn);
  const existingOe = asArray(part.oeNumbers).map(text).filter(Boolean);
  const oeNumbers = [...new Set([...existingOe, ...officialOe])]
    .filter((value) => normalizeToken(value) !== normalizeToken(enrichedRow.mpn));
  const normalizedImageUrl = imageUrl;
  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE "CanonicalPart" SET title = $2, description = $3, "itemSpecifics" = $4::jsonb,
       "imageUrls" = ARRAY[$5]::text[], "oeNumbers" = $6::text[],
       "enrichmentStatus" = 'DONE', "enrichmentVersion" = COALESCE("enrichmentVersion", 0) + 1,
       "enrichmentSource" = $7, "enrichedAt" = now(), "updatedAt" = now()
       WHERE id = $1 AND COALESCE(array_length("imageUrls", 1), 0) = 0
       AND EXISTS (SELECT 1 FROM "SellerOffer" WHERE "canonicalPartId" = $1 AND "sellerId" = 'seller-superior-auto-parts' AND status = 'ACTIVE')`,
      [result.id, title, description, JSON.stringify(specifics), normalizedImageUrl, oeNumbers, SOURCE],
    );
    await client.query(
      `INSERT INTO "ProductMedia" (id, "canonicalPartId", url, "normalizedUrl", "sourceUrl", "sortOrder", "isPrimary", "mediaType", "importStatus", "altText")
       VALUES ($1, $2, $3, $3, $4, 0, TRUE, 'IMAGE', 'IMPORTED', $5)
       ON CONFLICT ("canonicalPartId", "normalizedUrl") DO UPDATE SET "sourceUrl" = EXCLUDED."sourceUrl", "sortOrder" = 0, "isPrimary" = TRUE, "importStatus" = 'IMPORTED', "altText" = EXCLUDED."altText"`,
      [crypto.randomUUID(), result.id, normalizedImageUrl, result.sourceUrl, `${enrichedRow.brand} ${title} product image`],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  result.status = 'updated';
  result.title = title;
  result.officialOeNumbers = officialOe;
  return result;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY is required');
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const rows = asArray(input.rows);
  const requestedWorkers = Number.parseInt(process.env.OFFICIAL_WORKERS || '1', 10);
  const workerCount = Math.max(1, Math.min(Number.isFinite(requestedWorkers) ? requestedWorkers : 1, rows.length || 1));
  const runWorker = async (workerIndex) => {
    const client = new PgClient({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      for (let index = workerIndex; index < rows.length; index += workerCount) {
        const row = rows[index];
        try {
          console.log(JSON.stringify(await applyRow(client, row)));
        } catch (error) {
          console.log(JSON.stringify({
            id: text(row?.id),
            productUrl: `https://partsbazar360.com/buyer/part/${text(row?.id)}/`,
            status: 'failed',
            error: error?.message || String(error),
          }));
        }
      }
    } finally {
      await client.end();
    }
  };
  await Promise.all(Array.from({ length: workerCount }, (_, index) => runWorker(index)));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
