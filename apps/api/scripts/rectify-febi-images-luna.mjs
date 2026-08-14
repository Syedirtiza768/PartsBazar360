/**
 * Evidence-first GPT-5.6 Luna cleanup for active listing images.
 *
 * The worker reviews every distinct image attached through either
 * CanonicalPart.imageUrls or ProductMedia. It removes only images that Luna
 * marks as a high-confidence wrong-part/unrelated/non-product image. REVIEW
 * and low-confidence results are deliberately left untouched.
 *
 * Safe workflow:
 *   DRY_RUN=1 BRAND=FEBI LIMIT=50 WORKERS=12 node scripts/rectify-febi-images-luna.mjs
 *   IDS_PATH=/tmp/candidates.txt SELLER_ID=seller-superior-auto-parts WORKERS=12 node scripts/rectify-febi-images-luna.mjs
 *
 * Required environment: DATABASE_URL, OPENROUTER_API_KEY
 * Optional: BRAND, SELLER_ID, MODEL, LIMIT, WORKERS, DELAY_MS, DRY_RUN,
 *           BACKUP_PATH, REPORT_PATH, IDS (comma-separated part IDs), IDS_PATH
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const BRAND_FILTER = String(process.env.BRAND || '').trim().toUpperCase() || null;
const SELLER_ID = String(process.env.SELLER_ID || 'seller-superior-auto-parts').trim();
const MODEL = process.env.MODEL || 'openai/gpt-5.6-luna';
const SOURCE = process.env.SOURCE || (BRAND_FILTER
  ? 'gpt-5.6-luna:febi-image-rectification-v1'
  : 'gpt-5.6-luna:superior-nonapproved-image-cleanup-v1');
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const LIMIT = readNumber('LIMIT');
const WORKERS = Math.max(1, Math.min(Number(process.env.WORKERS || 12), 24));
const DELAY_MS = Math.max(0, Number(process.env.DELAY_MS || 100));
const DRY_RUN = process.env.DRY_RUN === '1';
const IDS = String(process.env.IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const IDS_PATH = String(process.env.IDS_PATH || '').trim();
const USER_AGENT = 'PartsBazar360/1.0 (+https://partsbazar360.com; catalog image quality pass)';

function readNumber(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value, max) {
  const normalized = text(value);
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max - 1).replace(/\s+\S*$/, '').trim()}…`;
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

function urlKey(value) {
  return normalizeUrl(value).toLowerCase();
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

function getMpn(part) {
  return text(part.manufacturerPartNumber)
    || text(asArray(part.oeNumbers).find(Boolean));
}

function getPartType(part) {
  return text(part.partType) || text(part.category) || text(part.title);
}

function getImageHost(imageUrl) {
  try {
    return new URL(imageUrl).hostname;
  } catch {
    return '';
  }
}

function buildPrompt(part, imageUrl, imageHealth) {
  const evidence = {
    brand: text(part.brand),
    manufacturer: text(part.manufacturer),
    manufacturerPartNumber: getMpn(part),
    title: clip(part.title, 180),
    category: clip(part.category, 120),
    categoryGroup: clip(part.categoryGroup, 120),
    partType: clip(getPartType(part), 140),
    position: clip(part.position, 80),
    vehicleSystem: clip(part.vehicleSystem, 100),
    partSource: text(part.partSource),
    qualityTier: text(part.qualityTier),
    offerMetadata: asObject(part.offerMetadata),
    currentDescription: clip(part.description, 1000),
    currentItemSpecifics: clip(JSON.stringify(asObject(part.itemSpecifics)), 1800),
    compatibility: clip(JSON.stringify(part.compatibility ?? {}), 1200),
    fitmentStatus: text(part.fitmentStatus),
    fitmentConfidence: part.fitmentConfidence ?? null,
    activeOfferSources: asArray(part.sourceTags).map(text).filter(Boolean),
    oeNumbers: asArray(part.oeNumbers).map(text).filter(Boolean).slice(0, 16),
    imageUrl,
    imageHost: getImageHost(imageUrl),
    imageHealth,
  };

  return `Review one image attached to an active automotive marketplace listing.

Return ONLY one JSON object with exactly these keys:
{
  "decision": "KEEP" or "REMOVE" or "REVIEW",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "imageAssessment": "MATCH" or "WRONG_PART" or "UNRELATED" or "NON_PRODUCT" or "PLACEHOLDER" or "UNCERTAIN",
  "reason": "short factual reason"
}

Rules:
- Judge the pixels first. The URL and hostname are only weak provenance hints.
- KEEP only when the image clearly shows a real automotive product matching the
  supplied listing identity and product type. A normal official catalog
  packshot is acceptable even when the part number is not printed in the image,
  if the visible product is consistent and the evidence is coherent.
- REMOVE only when the image clearly shows a different part, a non-automotive
  or unrelated photograph, a government/news/social-media image, a vehicle-only
  scene, a logo/placeholder, or another obvious non-product asset. REMOVE must
  have HIGH confidence.
- If the image is too small, ambiguous, damaged, or merely lacks enough proof,
  choose REVIEW. Do not remove uncertain images.
- Do not infer exact identity from a URL filename alone. Do not use web search
  or outside facts to invent a match.

Listing evidence:
${JSON.stringify(evidence)}`;
}

async function validateImageUrl(url) {
  const imageUrl = normalizeUrl(url);
  if (!/^https?:\/\//i.test(imageUrl) || /\.svg(?:[?#]|$)/i.test(imageUrl)) {
    return { status: 'invalid_url' };
  }
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  try {
    const head = await fetch(imageUrl, {
      method: 'HEAD',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    const contentType = text(head.headers.get('content-type')).toLowerCase();
    if (head.ok && contentType.startsWith('image/')) return { status: 'valid', contentType };
  } catch {}

  try {
    const response = await fetch(imageUrl, {
      headers: { ...headers, Range: 'bytes=0-4095' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    const contentType = text(response.headers.get('content-type')).toLowerCase();
    await response.body?.cancel();
    if (response.ok && contentType.startsWith('image/')) return { status: 'valid', contentType };
  } catch {}
  return { status: 'invalid_image' };
}

async function downloadImageDataUrl(url) {
  const response = await fetch(normalizeUrl(url), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  const contentType = text(response.headers.get('content-type')).toLowerCase();
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (!response.ok || !contentType.startsWith('image/') || contentLength > 8_000_000) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 8_000_000) return null;
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

async function callLuna(part, imageUrl, imageHealth, imageInputUrl = imageUrl) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://partsbazar360.com',
    'X-Title': 'PartsBazar360 catalog image rectification',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a strict automotive product-image quality reviewer. Never guess. Return valid JSON only.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(part, imageUrl, imageHealth) },
            { type: 'image_url', image_url: { url: imageInputUrl, detail: 'low' } },
          ],
        },
      ],
      temperature: 0.05,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${responseBody.slice(0, 500)}`);
  const data = JSON.parse(responseBody);
  const message = data.choices?.[0]?.message;
  return { result: parseJson(message?.content || message?.reasoning), usage: data.usage || null };
}

function classifyResult(result, imageHealth) {
  const decision = text(result?.decision).toUpperCase();
  const confidence = text(result?.confidence).toUpperCase();
  const assessment = text(result?.imageAssessment).toUpperCase();
  const removeAssessments = new Set(['WRONG_PART', 'UNRELATED', 'NON_PRODUCT', 'PLACEHOLDER']);
  const remove = imageHealth.status !== 'valid'
    || (decision === 'REMOVE' && confidence === 'HIGH' && removeAssessments.has(assessment));
  return {
    decision: remove ? 'REMOVE' : (decision === 'KEEP' ? 'KEEP' : 'REVIEW'),
    confidence: confidence || 'UNKNOWN',
    imageAssessment: assessment || (imageHealth.status === 'valid' ? 'UNCERTAIN' : 'BROKEN'),
    remove,
    reason: text(result?.reason) || (imageHealth.status !== 'valid' ? 'Image URL failed direct validation.' : 'No safe automatic decision.'),
  };
}

function imageRows(part) {
  const rows = [];
  const seen = new Set();
  for (const rawUrl of asArray(part.imageUrls)) {
    const url = normalizeUrl(rawUrl);
    const key = urlKey(url);
    if (!url || seen.has(key)) continue;
    seen.add(key);
    rows.push({ url, key, mediaId: null, channel: 'imageUrls' });
  }
  for (const media of asArray(part.media)) {
    const url = normalizeUrl(media?.url);
    const key = urlKey(url);
    if (!url) continue;
    if (!seen.has(key)) {
      seen.add(key);
      rows.push({ url, key, mediaId: text(media?.id) || null, channel: 'ProductMedia' });
    } else {
      const existing = rows.find((row) => row.key === key);
      if (existing && !existing.mediaId) existing.mediaId = text(media?.id) || null;
    }
  }
  return rows;
}

async function fetchParts(pool) {
  const limitSql = LIMIT == null ? '' : `LIMIT ${Math.max(0, LIMIT)}`;
  const candidateIds = [...new Set([
    ...IDS,
    ...(IDS_PATH ? (await fs.readFile(IDS_PATH, 'utf8'))
      .split(/\r?\n/).map((value) => value.trim()).filter(Boolean) : []),
  ])];
  const params = [SELLER_ID];
  const predicates = [
    `EXISTS (
      SELECT 1 FROM "SellerOffer" so
      WHERE so."canonicalPartId" = cp.id
        AND so."sellerId" = $1
        AND so.status = 'ACTIVE'
    )`,
  ];
  if (BRAND_FILTER) {
    params.push(BRAND_FILTER);
    predicates.push(`upper(trim(cp.brand)) = $${params.length}`);
  }
  if (candidateIds.length) {
    params.push(candidateIds);
    predicates.push(`cp.id = ANY($${params.length}::text[])`);
  }
  const whereSql = predicates.join('\n      AND ');
  const result = await pool.query(`
    SELECT cp.id, cp.title, cp.brand, cp.manufacturer,
      cp."manufacturerPartNumber", cp."oeNumbers", cp.category, cp."categoryGroup",
      cp."partType", cp."partSource", cp."qualityTier", cp.position,
      cp."vehicleSystem", cp.description, cp."itemSpecifics", cp.compatibility,
      cp."fitmentStatus", cp."fitmentConfidence", cp."imageUrls",
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', pm.id,
          'url', pm.url,
          'normalizedUrl', pm."normalizedUrl",
          'sortOrder', pm."sortOrder",
          'isPrimary', pm."isPrimary"
        ) ORDER BY pm."sortOrder", pm."createdAt")
        FROM "ProductMedia" pm
        WHERE pm."canonicalPartId" = cp.id
      ), '[]'::json) AS media,
      COALESCE((
        SELECT json_build_object(
          'condition', so.condition,
          'partSource', so."partSource",
          'qualityTier', so."qualityTier",
          'sellerTitle', so."sellerTitle",
          'sellerSku', so."sellerSku"
        )
        FROM "SellerOffer" so
        WHERE so."canonicalPartId" = cp.id
          AND so."sellerId" = $1
          AND so.status = 'ACTIVE'
        ORDER BY so."updatedAt" DESC
        LIMIT 1
      ), '{}'::json) AS "offerMetadata",
      COALESCE((
        SELECT array_agg(DISTINCT so."sourceTag")
        FROM "SellerOffer" so
        WHERE so."canonicalPartId" = cp.id
          AND so."sellerId" = $1
          AND so.status = 'ACTIVE'
      ), ARRAY[]::text[]) AS "sourceTags"
    FROM "CanonicalPart" cp
    WHERE ${whereSql}
      AND (
        COALESCE(array_length(cp."imageUrls", 1), 0) > 0
        OR EXISTS (SELECT 1 FROM "ProductMedia" pm WHERE pm."canonicalPartId" = cp.id)
      )
    ORDER BY cp.id
    ${limitSql}
  `, params);
  return result.rows;
}

async function applyRemovals(pool, part, rows, report) {
  const removedKeys = new Set(rows.filter((row) => row.review.remove).map((row) => row.key));
  if (!removedKeys.size) return false;

  const originalImageUrls = asArray(part.imageUrls).map(normalizeUrl).filter(Boolean);
  const nextImageUrls = originalImageUrls.filter((url) => !removedKeys.has(urlKey(url)));
  const media = asArray(part.media);
  const removedMediaIds = media
    .filter((item) => removedKeys.has(urlKey(item?.url)) || removedKeys.has(urlKey(item?.normalizedUrl)))
    .map((item) => text(item?.id))
    .filter(Boolean);
  const remainingMedia = media.filter((item) => !removedMediaIds.includes(text(item?.id)));
  const hadPrimaryRemoved = media.some((item) => item?.isPrimary && removedMediaIds.includes(text(item?.id)));
  const hasRemainingPrimary = remainingMedia.some((item) => item?.isPrimary);
  const replacementPrimaryId = (!hasRemainingPrimary || hadPrimaryRemoved)
    ? text(remainingMedia[0]?.id) || null
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const params = [part.id, nextImageUrls, SELLER_ID];
    const brandGuard = BRAND_FILTER
      ? (() => {
          params.push(BRAND_FILTER);
          return 'AND upper(trim(cp.brand)) = $4';
        })()
      : '';
    const updated = await client.query(`
      UPDATE "CanonicalPart" cp
      SET "imageUrls" = $2::text[], "updatedAt" = now()
      WHERE cp.id = $1
        ${brandGuard}
        AND EXISTS (
          SELECT 1 FROM "SellerOffer" so
          WHERE so."canonicalPartId" = cp.id
            AND so."sellerId" = $3
            AND so.status = 'ACTIVE'
        )
      RETURNING cp.id
    `, params);
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      report.status = 'stale_skipped';
      report.reviewReason = 'Listing was no longer active for the target seller when the write was attempted.';
      return false;
    }

    if (removedMediaIds.length) {
      await client.query(
        `DELETE FROM "ProductMedia" WHERE id = ANY($1::text[]) AND "canonicalPartId" = $2`,
        [removedMediaIds, part.id],
      );
    }
    if (replacementPrimaryId) {
      await client.query(
        `UPDATE "ProductMedia" SET "isPrimary" = (id = $2) WHERE "canonicalPartId" = $1`,
        [part.id, replacementPrimaryId],
      );
    }
    await client.query(`
      INSERT INTO "SearchOutbox" (
        id, "entityType", "entityId", operation, payload, status, "createdAt", "updatedAt"
      )
      VALUES (gen_random_uuid(), 'CanonicalPart', $1, 'UPSERT', $2::jsonb, 'PENDING', now(), now())
    `, [part.id, JSON.stringify({ reason: SOURCE, removedImages: rows.filter((row) => row.review.remove).length })]);
    await client.query('COMMIT');
    report.status = 'updated';
    report.removedImageUrls = rows.filter((row) => row.review.remove).map((row) => row.url);
    report.remainingImageUrls = nextImageUrls;
    report.removedMediaIds = removedMediaIds;
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY is required');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = process.env.BACKUP_PATH || `/tmp/febi-image-luna-backup-${stamp}.jsonl`;
  const reportPath = process.env.REPORT_PATH || `/tmp/febi-image-luna-report-${stamp}.jsonl`;
  await ensureParent(backupPath);
  await ensureParent(reportPath);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.min(WORKERS + 2, 32) });
  try {
    const parts = await fetchParts(pool);
    await fs.writeFile(
      backupPath,
      `${parts.map((part) => JSON.stringify({
        ...part,
        media: asArray(part.media),
      })).join('\n')}\n`,
      'utf8',
    );
    console.log(JSON.stringify({ event: 'start', sellerId: SELLER_ID, brand: BRAND_FILTER, model: MODEL, source: SOURCE, total: parts.length, workers: WORKERS, dryRun: DRY_RUN, backupPath, reportPath }));

    const reports = [];
    let cursor = 0;
    let completed = 0;
    let changed = 0;
    let removedImages = 0;
    let reviewedImages = 0;
    let failed = 0;

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= parts.length) return;
        const part = parts[index];
        const report = {
          id: part.id,
          title: part.title,
          brand: part.brand,
          manufacturerPartNumber: getMpn(part),
          sourceTags: part.sourceTags,
          status: 'started',
          images: [],
        };
        try {
          const urls = imageRows(part);
          for (const item of urls) {
            const imageHealth = await validateImageUrl(item.url);
            let review;
            let usage = null;
            if (imageHealth.status !== 'valid') {
              review = classifyResult({}, imageHealth);
            } else {
              let result;
              try {
                result = await callLuna(part, item.url, imageHealth);
              } catch (firstError) {
                const fallbackImage = await downloadImageDataUrl(item.url).catch(() => null);
                if (!fallbackImage) throw firstError;
                result = await callLuna(part, item.url, imageHealth, fallbackImage);
              }
              usage = result.usage;
              review = classifyResult(result.result, imageHealth);
            }
            item.review = review;
            report.images.push({
              url: item.url,
              channel: item.channel,
              mediaId: item.mediaId,
              imageHealth,
              ...review,
              usage,
            });
            if (review.remove) removedImages++;
            else if (review.decision === 'REVIEW') reviewedImages++;
          }

          if (DRY_RUN) {
            report.status = report.images.some((item) => item.remove) ? 'dry_run_would_update' : 'unchanged';
          } else {
            const didUpdate = await applyRemovals(pool, part, urls, report);
            if (didUpdate) {
              changed++;
              report.removedImageCount = report.removedImageUrls?.length || 0;
            } else if (report.status === 'started') {
              report.status = 'unchanged';
            }
          }
        } catch (error) {
          failed++;
          report.status = 'failed';
          report.error = error?.message || String(error);
        }
        reports.push(report);
        completed++;
        if (completed === 1 || completed % 50 === 0 || completed === parts.length) {
          console.log(JSON.stringify({ event: 'progress', completed, total: parts.length, changed, removedImages, reviewedImages, failed }));
        }
        if (DELAY_MS) await sleep(DELAY_MS);
      }
    }

    await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(1, parts.length)) }, worker));
    await fs.writeFile(reportPath, `${reports.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'done', total: parts.length, changed, removedImages, reviewedImages, failed, dryRun: DRY_RUN, backupPath, reportPath }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
