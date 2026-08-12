#!/usr/bin/env node

/**
 * Find exact product images for active Superior Auto Parts listings with no
 * current image, using Tavily's image-enabled search response.
 *
 * This is deliberately conservative. It only writes an image when the image
 * metadata and a Tavily source result identify the same brand and exact MPN,
 * the URL is not a known placeholder, and the URL responds as an image.
 * Existing CanonicalPart images are never replaced.
 */
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client as PgClient } from 'pg';

const TAVILY_URL = 'https://api.tavily.com/search';
const SELLER_NAME = process.env.TAVILY_SELLER_NAME || 'Superior Auto Parts';
const BRAND_FILTER = cleanEnv(process.env.TAVILY_BRAND_FILTER || '');
const SOURCE = process.env.TAVILY_IMAGE_SOURCE || 'tavily:superior-exact-image-v1';
const CONCURRENCY = Math.max(1, Number(process.env.TAVILY_CONCURRENCY || 2));
const DELAY_MS = Math.max(0, Number(process.env.TAVILY_DELAY_MS || 400));
const LIMIT = readNumberArg('--limit');
const AFTER_ID = readStringArg('--after');
const DRY_RUN = process.env.TAVILY_DRY_RUN === '1';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const REPORT_PATH = process.env.TAVILY_REPORT_PATH || '/tmp/superior-tavily-image-report.jsonl';
const BACKUP_PATH = process.env.TAVILY_BACKUP_PATH || '/tmp/superior-tavily-image-backup.jsonl';
const USER_AGENT =
  'PartsBazar360/1.0 (+https://partsbazar360.com; exact automotive product image lookup)';

function readNumberArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readStringArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function cleanEnv(value) {
  return String(value || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value) {
  return cleanText(value)
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
    return cleanText(value);
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function hasKnownPlaceholder(value) {
  return /(placeholder|no[-_ ]?image|no[-_ ]?photo|missing[-_ ]?image|default[-_ ]?image|image[-_ ]?not[-_ ]?available|spacer|transparent|blank\.gif|ajax[-_ ]?loader|loading|avatar|logo|favicon|sprite|tracking|pixel)/i.test(
    String(value || ''),
  );
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

function imageMetadata(image) {
  if (typeof image === 'string') return { url: image, title: '', description: '' };
  return {
    url: image?.url || image?.image_url || image?.imageUrl || '',
    title: image?.title || image?.name || '',
    description: image?.description || image?.alt || '',
  };
}

function sourceText(result) {
  return cleanText(
    `${result?.title || ''} ${result?.url || ''} ${result?.content || ''} ${result?.raw_content || ''}`,
  );
}

function hasExactEvidence(text, brand, mpn) {
  const normalized = normalizeToken(text);
  return Boolean(
    normalizeToken(brand) &&
      normalizeToken(mpn) &&
      normalized.includes(normalizeToken(brand)) &&
      normalized.includes(normalizeToken(mpn)),
  );
}

function hasPhotoMismatch(text) {
  return /(woman|man|person|people|vehicle photo|car photo|truck photo|engine bay|checks? (?:the )?radiator|intercooler|dashboard|on the road|driving|workshop scene|garage scene|banner|advertisement|illustration|diagram|technical drawing|schematic|logo|generic category)/i.test(
    text,
  );
}

function hasCategoryMismatch(text, partTitle) {
  const title = String(partTitle || '').toLowerCase();
  const image = String(text || '').toLowerCase();
  const rules = [
    [/(bush|bushing|control arm|trailing arm)/, /(cv axle|drive shaft|half shaft|axle shaft)/],
    [/(bush|bushing|control arm|trailing arm)/, /(pulley|tensioner|v-ribbed|belt|wheel-like)/],
    [/(air spring|air strut|air suspension)/, /(bulb|headlight|lamp|lighting)/],
    [/(brake pad|brake disc|brake rotor|brake shoe)/, /(air filter|oil filter|fuel filter|shock absorber|radiator hose|fuel pump)/],
    [/(air filter|oil filter|fuel filter)/, /(brake pad|brake disc|shock absorber|fuel pump|cv axle)/],
    [/(shock absorber|strut)/, /(brake pad|brake disc|air filter|fuel pump|cv axle)/],
    [/(fuel pump)/, /(brake pad|brake disc|air filter|shock absorber|cv axle)/],
    [/(radiator hose|coolant hose)/, /(brake pad|air filter|fuel pump|shock absorber|cv axle)/],
    [/(hood seal|rubber seal)/, /(tire valve|valve|bolt|filter|pump)/],
  ];
  return rules.some(([titlePattern, imagePattern]) => titlePattern.test(title) && imagePattern.test(image));
}

function hasConflictingMpn(text, candidate, mpn) {
  const target = normalizeToken(mpn);
  const title = String(candidate?.title || '');
  const url = String(candidate?.url || '');
  let pathname = url;
  try { pathname = new URL(url).pathname; } catch { /* keep the raw URL */ }
  if (normalizeToken(url).includes(target)) return false;

  // If the image title/URL advertises another code-like product number while
  // the exact MPN appears only in a generated image description, reject it.
  // This prevents a V30-3771 pulley from passing for V30-3171 just because a
  // search description repeated the requested number.
  const codeText = `${title} ${pathname}`;
  const codes = [
    ...(codeText.match(/[A-Z0-9]+(?:[-/][A-Z0-9]+){1,}/gi) || []),
    ...(codeText.match(/[A-Z]{1,8}-\d{2,}(?:-[A-Z0-9]+)*/gi) || []),
    ...(pathname.match(/(?:[A-Z0-9]*\d[A-Z][A-Z0-9]*|[A-Z]\d{2,})-\d+(?:-\d+)+(?:-[A-Z0-9]+)?/gi) || []),
    ...(pathname.match(/(?:^|[^A-Z0-9])([A-Z0-9]{8,})(?=[^A-Z0-9]|$)/gi) || []),
    ...(pathname.match(/(?:^|[/_-])(\d{5,9})(?=[/_\-.]|$)/gi) || []),
  ];
  return codes.some((code) => {
    const normalized = normalizeToken(code);
    if (!normalized || normalized === target) return false;
    const prefix = target.match(/^[A-Z]+/)?.[0] || '';
    const mixedCode = /[A-Z]/i.test(normalized) && /\d/.test(normalized);
    const digitCount = (normalized.match(/\d/g) || []).length;
    const numericCode = /^\d+$/.test(normalized);
    const sameFamily = prefix && normalized.startsWith(prefix);
    const comparableMixedCode = mixedCode && digitCount >= 4 && Math.abs(normalized.length - target.length) <= 3;
    const comparableNumericCode = numericCode && /^\d+$/.test(target) && Math.abs(normalized.length - target.length) <= 2;
    return (sameFamily && Math.abs(normalized.length - target.length) <= 3) || comparableMixedCode || comparableNumericCode;
  });
}

function findSource(results, brand, mpn) {
  const exact = (results || []).find((result) => hasExactEvidence(sourceText(result), brand, mpn));
  return exact || (results || [])[0] || null;
}

function candidateScore(candidate, brand, mpn, partTitle) {
  const text = cleanText(`${candidate.title} ${candidate.description} ${candidate.url}`);
  if (!isHttpUrl(candidate.url) || hasKnownPlaceholder(text) || /\.svg(?:[?#]|$)/i.test(candidate.url)) {
    return -Infinity;
  }
  if (
    !hasExactEvidence(text, brand, mpn) ||
    hasPhotoMismatch(text) ||
    hasCategoryMismatch(text, partTitle) ||
    hasConflictingMpn(text, candidate, mpn)
  ) return -Infinity;

  let score = 100;
  if (normalizeToken(candidate.description).includes(normalizeToken(mpn))) score += 35;
  if (normalizeToken(candidate.title).includes(normalizeToken(mpn))) score += 20;
  if (normalizeToken(candidate.description).includes(normalizeToken(brand))) score += 15;
  if (/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(candidate.url)) score += 4;
  return score;
}

async function validateImageUrl(imageUrl) {
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
    const contentType = String(head.headers.get('content-type') || '').toLowerCase();
    const contentLength = Number(head.headers.get('content-length') || 0);
    if (head.ok && contentType.startsWith('image/') && (!contentLength || contentLength >= 1200)) {
      return { status: 'valid', contentType, contentLength: contentLength || null };
    }
  } catch {
    // A number of image CDNs reject HEAD; retry with a small ranged GET below.
  }

  try {
    const response = await fetch(imageUrl, {
      headers: { ...headers, Range: 'bytes=0-4095' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (response.ok && contentType.startsWith('image/') && (!contentLength || contentLength >= 1200)) {
      await response.body?.cancel();
      return { status: 'valid', contentType, contentLength: contentLength || null };
    }
    await response.body?.cancel();
  } catch {
    // The caller records the rejection without making a catalog write.
  }
  return { status: 'invalid_image' };
}

async function tavilySearch(part) {
  const brand = getBrand(part);
  const mpn = getMpn(part);
  if (!brand || !mpn) return { status: 'missing_evidence' };
  if (!TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is required');

  const query = `"${brand}" "${mpn}" automotive part product image`;
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: 8,
          include_answer: false,
          include_images: true,
          include_image_descriptions: true,
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 3_000 * (attempt + 1));
  }

  const body = await response.text();
  if (!response.ok) throw new Error(`Tavily ${response.status}: ${body.slice(0, 300)}`);
  const data = JSON.parse(body);
  const results = Array.isArray(data.results) ? data.results : [];
  const source = findSource(results, brand, mpn);
  const images = [
    ...(Array.isArray(data.images) ? data.images : []),
    ...results.flatMap((result) => (Array.isArray(result.images) ? result.images : [])),
  ].map(imageMetadata);

  const candidates = images
    .map((image) => ({ ...image, url: normalizeUrl(image.url) }))
    .map((image) => ({ image, score: candidateScore(image, brand, mpn, `${part.title} ${source?.title || ''}`) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return { status: 'no_exact_image', query, resultCount: results.length, imageCount: images.length };
  }

  for (const item of candidates) {
    const validation = await validateImageUrl(item.image.url);
    if (validation.status !== 'valid') continue;
    if (!source || !hasExactEvidence(sourceText(source), brand, mpn)) continue;
    return {
      status: 'matched',
      imageUrl: item.image.url,
      sourceUrl: normalizeUrl(source.url),
      evidence: cleanText(`${item.image.title} ${item.image.description}`),
      sourceTitle: cleanText(source.title),
      query,
      resultCount: results.length,
      imageCount: images.length,
      contentType: validation.contentType,
      contentLength: validation.contentLength,
    };
  }
  return { status: 'no_valid_image', query, resultCount: results.length, imageCount: images.length };
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
        `Product image for exact ${part.brand || ''} ${getMpn(part)}`.trim(),
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
  const params = [SELLER_NAME];
  let nextParam = 2;
  const brandClause = BRAND_FILTER ? `AND upper(trim(coalesce(cp.brand,'')))=upper($${nextParam++})` : '';
  if (BRAND_FILTER) params.push(BRAND_FILTER);
  const afterClause = AFTER_ID ? `AND cp.id > $${nextParam++}` : '';
  if (AFTER_ID) params.push(AFTER_ID);
  const limit = LIMIT == null ? 100 : Math.max(0, LIMIT);
  params.push(limit);
  const result = await client.query(
    `SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber", cp."oeNumbers", cp.category, cp."partType", cp."imageUrls"
     FROM "CanonicalPart" cp
     JOIN "SellerOffer" so ON so."canonicalPartId"=cp.id AND so.status='ACTIVE'
     JOIN "Seller" s ON s.id=so."sellerId" AND s.name=$1
     WHERE COALESCE(array_length(cp."imageUrls",1),0)=0
       ${brandClause}
       ${afterClause}
     GROUP BY cp.id, cp.title, cp.brand, cp."manufacturerPartNumber", cp."oeNumbers", cp.category, cp."partType", cp."imageUrls"
     ORDER BY cp.id
     LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!TAVILY_API_KEY && !DRY_RUN) throw new Error('TAVILY_API_KEY is required');
  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const parts = await fetchParts(client);
    await fs.writeFile(BACKUP_PATH, `${parts.map((part) => JSON.stringify(part)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'start', seller: SELLER_NAME, brand: BRAND_FILTER || null, source: SOURCE, total: parts.length, concurrency: CONCURRENCY, dryRun: DRY_RUN, backupPath: BACKUP_PATH, reportPath: REPORT_PATH }));

    const report = [];
    let cursor = 0;
    let completed = 0;
    let imageUpdated = 0;
    let failed = 0;
    const counts = {};

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= parts.length) return;
        const part = parts[index];
        const row = { id: part.id, title: part.title, brand: part.brand, mpn: getMpn(part), status: 'started' };
        try {
          const match = await tavilySearch(part);
          row.imageStatus = match.status;
          row.imageUrl = match.imageUrl || null;
          row.sourceUrl = match.sourceUrl || null;
          row.evidence = match.evidence || null;
          row.sourceTitle = match.sourceTitle || null;
          row.query = match.query || null;
          row.contentType = match.contentType || null;
          row.contentLength = match.contentLength || null;
          counts[match.status] = (counts[match.status] || 0) + 1;
          if (!DRY_RUN && match.status === 'matched') {
            row.imageAdded = await upsertImage(client, part, match);
            if (row.imageAdded) imageUpdated += 1;
          }
          row.status = DRY_RUN ? 'dry_run' : 'checked';
        } catch (error) {
          failed += 1;
          row.status = 'failed';
          row.error = error?.message || String(error);
        }
        report.push(row);
        completed += 1;
        if (completed % 5 === 0 || completed === parts.length) {
          console.log(JSON.stringify({ event: 'progress', completed, total: parts.length, imageUpdated, failed, counts }));
        }
        if (DELAY_MS) await sleep(DELAY_MS);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, parts.length)) }, worker));
    await fs.writeFile(REPORT_PATH, `${report.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'done', seller: SELLER_NAME, total: parts.length, imageUpdated, failed, counts, source: SOURCE, backupPath: BACKUP_PATH, reportPath: REPORT_PATH }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
