#!/usr/bin/env node

/**
 * Evidence-first GPT-5.6 Luna pass for active Superior Auto Parts products.
 * The runner assesses a current primary image when present but never replaces
 * it. It writes only approved factual page content and leaves contradictory or
 * visually uncertain products in the report for review. No-image rows may get
 * factual SEO content but remain noindex until the image gate passes.
 *
 * Safe workflow:
 *   DRY_RUN=1 LIMIT=25 node scripts/enhance-superior-imaged-luna.mjs
 *   LIMIT=25 node scripts/enhance-superior-imaged-luna.mjs
 *
 * Required environment: DATABASE_URL, OPENROUTER_API_KEY
 * Optional: LIMIT, OFFSET, ENHANCE_CONCURRENCY, ENHANCE_DELAY_MS,
 *           ENHANCE_IDS, ENHANCE_SOURCE, ENHANCE_BACKUP_PATH,
 *           ENHANCE_REPORT_PATH, DRY_RUN=1, FORCE=1
 */
import fs from 'node:fs/promises';
import { Client as PgClient } from 'pg';

const MODEL = process.env.ENHANCE_MODEL || 'openai/gpt-5.6-luna';
const SOURCE = process.env.ENHANCE_SOURCE || 'gpt-5.6-luna:superior-imaged-seo-v1';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const LIMIT = readNumberArg('LIMIT');
const OFFSET = readNumberArg('OFFSET') || 0;
const CONCURRENCY = Math.max(1, Number(process.env.ENHANCE_CONCURRENCY || 3));
const DELAY_MS = Math.max(0, Number(process.env.ENHANCE_DELAY_MS || 250));
const DRY_RUN = process.env.DRY_RUN === '1';
const FORCE = process.env.FORCE === '1';
const INCLUDE_NO_IMAGE = process.env.INCLUDE_NO_IMAGE === '1';
const IDS = String(process.env.ENHANCE_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const USER_AGENT = 'PartsBazar360/1.0 (+https://partsbazar360.com; catalog quality pass)';

function readNumberArg(name) {
  const value = Number(process.env[name] || '');
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function isHttpImageUrl(value) {
  return /^https?:\/\//i.test(text(value)) && !/\.svg(?:[?#]|$)/i.test(text(value));
}

function clip(value, max) {
  const normalized = text(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).replace(/\s+\S*$/, '').trim()}…`;
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

function normalizeCondition(value) {
  const raw = text(value).toUpperCase();
  if (raw.includes('REMAN')) return 'Remanufactured';
  if (raw.includes('REFURB')) return 'Refurbished';
  if (raw.includes('USED')) return 'Used';
  if (raw.includes('NEW')) return 'New';
  return null;
}

function normalizeSource(value) {
  const raw = text(value).toUpperCase();
  if (raw.includes('AFTER')) return 'Aftermarket';
  if (raw.includes('OEM')) return 'OEM';
  if (raw.includes('SALVAGE')) return 'Salvage';
  return null;
}

function getMpn(part) {
  return text(part.manufacturerPartNumber || asArray(part.oeNumbers).find(Boolean));
}

function distinctOeNumbers(part) {
  const mpn = normalizeToken(getMpn(part));
  return [...new Set(asArray(part.oeNumbers).map(text).filter(Boolean))]
    .filter((number) => normalizeToken(number) !== mpn);
}

function cleanEvidenceSpecifics(part) {
  const next = { ...asObject(part.itemSpecifics) };
  const mpn = normalizeToken(getMpn(part));
  for (const key of ['oeNumber', 'manufacturerOeNumber', 'oemNumber']) {
    if (normalizeToken(next[key]) === mpn) delete next[key];
  }
  for (const key of ['oeNumbers', 'OE_numbers', 'oemNumbers']) {
    if (!Array.isArray(next[key])) continue;
    next[key] = next[key].map(text).filter((value) => normalizeToken(value) !== mpn);
    if (!next[key].length) delete next[key];
  }
  return next;
}

function getBrand(part) {
  const value = text(part.brand || part.manufacturer);
  return value && !/^unknown$/i.test(value) ? value : '';
}

function verifiedCompatibility(value) {
  return asArray(value)
    .filter((row) => row && row.verified === true && row.make && row.model)
    .slice(0, 12)
    .map((row) => ({
      year: row.year ?? null,
      make: text(row.make),
      model: text(row.model),
      trim: text(row.trim) || null,
      engine: text(row.engine) || null,
      source: text(row.source) || 'unknown',
    }));
}

async function validateImageUrl(url) {
  const imageUrl = normalizeUrl(url);
  if (!isHttpImageUrl(imageUrl)) return { status: 'invalid_url' };
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

function buildPrompt(part, imageUrl, imageHealth) {
  const offerSource = normalizeSource(part.offerPartSource || part.partSource);
  const offerCondition = normalizeCondition(part.offerCondition || part.qualityTier);
  const evidence = {
    currentTitle: text(part.title),
    brand: getBrand(part) || null,
    manufacturer: text(part.manufacturer) || null,
    manufacturerPartNumber: getMpn(part) || null,
    oeNumbers: distinctOeNumbers(part).slice(0, 16),
    category: text(part.category) || null,
    categoryGroup: text(part.categoryGroup) || null,
    partType: text(part.partType) || null,
    partSource: offerSource || null,
    condition: offerCondition || null,
    qualityTier: text(part.offerQualityTier || part.qualityTier) || null,
    currentDescription: clip(part.description, 1200),
    currentItemSpecifics: cleanEvidenceSpecifics(part),
    verifiedCompatibility: verifiedCompatibility(part.compatibility),
    fitmentStatus: text(part.fitmentStatus) || null,
    fitmentConfidence: part.fitmentConfidence ?? null,
    imageUrl,
    imageHealth,
  };

  return `Assess and improve one existing automotive product listing. The supplied image is the current primary image; do not replace it.

Return ONLY one JSON object with exactly these keys:
{
  "decision": "APPROVE" or "REVIEW",
  "identityConfidence": "HIGH" or "MEDIUM" or "LOW",
  "imageAssessment": "MATCH" or "MISMATCH" or "UNCERTAIN" or "NOT_AVAILABLE",
  "imageConfidence": "HIGH" or "MEDIUM" or "LOW",
  "title": "factual product title, max 80 characters",
  "description": "SKU-specific factual description, 80-1800 characters",
  "itemSpecifics": {},
  "contradictions": ["short contradiction or empty"],
  "reviewReason": "short reason"
}

Rules:
- Accuracy is more important than completeness or SEO.
- Treat the existing title and description as legacy text to be corrected, not as authoritative evidence. Use the structured catalog fields, active offer fields, and verified compatibility as the source of truth.
- Approve only when the structured identity is coherent and the image visibly matches the exact part identity. If the image does not show enough evidence, use UNCERTAIN and REVIEW; do not guess.
- If no image is supplied, set imageAssessment to NOT_AVAILABLE and imageConfidence to NONE. You may still approve factual text when the structured identity is HIGH confidence and contradictions is empty; the page remains noindex until a verified image exists.
- Never invent or upgrade OEM status, OE numbers, vehicle fitment, dimensions, material, warranty, performance, or included items.
- Treat seller offer source, condition, and quality tier as authoritative. Never call an aftermarket part genuine OEM.
- Use vehicle compatibility only when it is explicitly present in the supplied evidence and marked verified; AI-only rows are not authoritative.
- Keep the exact manufacturer part number unchanged. Do not duplicate the brand or add unsupported make/model terms.
- Use a more precise product type, axle position, or “set” wording only when that fact is explicit in the supplied title, item specifics, verified compatibility, or another authoritative catalog field. Never infer “rear,” “front,” or “set” from the generic category alone.
- When enough verified facts exist, organize the description with short labeled sections in plain text: Product overview; Part identification; OE / cross-reference numbers; Technical specifications; Vehicle compatibility. Omit empty sections. Do not pad a sparse listing with generic marketing language.
- Include every supplied OE/cross-reference number individually only when it is present in the evidence. Do not add examples from memory or from an unverified marketplace result.
- Do not describe the manufacturer part number itself as an OE or cross-reference number. If the only supplied number is the manufacturer part number, omit the OE / cross-reference section entirely.
- For sparse evidence, prefer a concise, useful description that states the exact part identity, category, source, condition, and the specific verification step the buyer still needs.
- itemSpecifics may contain only concise values supported by the supplied evidence; return an empty object when unsure.
- Set APPROVE only when identityConfidence is HIGH and contradictions is empty; when an image is supplied also require imageAssessment MATCH and imageConfidence HIGH. Otherwise set REVIEW.

Evidence:
${JSON.stringify(evidence)}`;
}

async function callLuna(part, imageUrl, imageHealth) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://partsbazar360.com',
      'X-Title': 'PartsBazar360 Superior existing-image SEO pass',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a strict automotive catalog quality reviewer. Never invent facts. Return valid JSON only.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(part, imageUrl, imageHealth) },
            ...(imageUrl ? [{ type: 'image_url', image_url: { url: imageUrl, detail: 'low' } }] : []),
          ],
        },
      ],
      temperature: 0.05,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${responseBody.slice(0, 600)}`);
  const data = JSON.parse(responseBody);
  const message = data.choices?.[0]?.message;
  return { result: parseJson(message?.content || message?.reasoning), usage: data.usage || null };
}

function cleanSpecifics(part, generated) {
  const current = asObject(part.itemSpecifics);
  const candidate = asObject(generated);
  const allowed = new Set([
    'partType', 'categoryType', 'position', 'material', 'color', 'features',
    'placementOnVehicle', 'vehicleSystem', 'surfaceFinish', 'detailBullets',
    'searchKeywords', 'productType', 'inferredProductType', 'brandType',
    'condition', 'qualityTier', 'manufacturer', 'manufacturerPartNumber',
  ]);
  const next = { ...current };
  for (const [key, value] of Object.entries(candidate)) {
    if (!allowed.has(key) || value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      const values = value.map(text).filter(Boolean).slice(0, 12);
      if (values.length) next[key] = values;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = typeof value === 'string' ? clip(value, 500) : value;
    }
  }

  const offerSource = normalizeSource(part.offerPartSource || part.partSource);
  const offerCondition = normalizeCondition(part.offerCondition || part.qualityTier);
  const mpn = getMpn(part);
  for (const key of ['oeNumber', 'manufacturerOeNumber', 'oemNumber']) {
    if (normalizeToken(next[key]) === normalizeToken(mpn)) delete next[key];
  }
  for (const key of ['oeNumbers', 'OE_numbers', 'oemNumbers']) {
    if (!Array.isArray(next[key])) continue;
    next[key] = next[key].map(text).filter((value) => normalizeToken(value) !== normalizeToken(mpn));
    if (!next[key].length) delete next[key];
  }
  if (part.manufacturer || part.brand) next.manufacturer = text(part.manufacturer || part.brand);
  if (mpn) next.manufacturerPartNumber = mpn;
  if (offerSource) next.brandType = offerSource;
  if (offerCondition) next.condition = offerCondition;
  if (part.offerQualityTier || part.qualityTier) next.qualityTier = text(part.offerQualityTier || part.qualityTier);
  return next;
}

function mergeContent(part, generated) {
  const fallbackTitle = [getBrand(part), text(part.partType || part.category), getMpn(part)].filter(Boolean).join(' ');
  const title = clip(generated.title || fallbackTitle || part.title, 80);
  const description = clip(generated.description || part.description || title, 1800);
  return {
    title: title || text(part.title),
    description: description || text(part.description),
    itemSpecifics: cleanSpecifics(part, generated.itemSpecifics),
  };
}

function addSeoEvidence(content, generated, gate, hasImage, imageHealth) {
  const imageAssessment = hasImage
    ? text(generated?.imageAssessment).toUpperCase() || 'UNKNOWN'
    : 'NOT_AVAILABLE';
  const imageConfidence = hasImage
    ? text(generated?.imageConfidence).toUpperCase() || 'NONE'
    : 'NONE';
  return {
    ...content,
    itemSpecifics: {
      ...content.itemSpecifics,
      _seo: {
        source: SOURCE,
        decision: gate.approved ? 'APPROVE' : 'CONTENT_UPDATED_IMAGE_REVIEW',
        identityConfidence: text(generated?.identityConfidence).toUpperCase() || 'UNKNOWN',
        imageAssessment,
        imageConfidence,
        imageHealth: imageHealth.status,
      },
    },
  };
}

function authorityConflictIsResolvable(part, generated, contradiction) {
  const phrase = text(contradiction).toLowerCase();
  if (/(oe|cross-reference)/i.test(phrase) && /manufacturer part number|mpn/i.test(phrase)
    && distinctOeNumbers(part).length === 0) return true;
  if (!/(condition|quality|oem|aftermarket|genuine|part source|source)/i.test(phrase)) return false;
  const source = normalizeSource(part.offerPartSource || part.partSource);
  const condition = normalizeCondition(part.offerCondition || part.qualityTier);
  const specifics = asObject(generated?.itemSpecifics);
  const normalizedGeneratedSource = normalizeSource(specifics.brandType || specifics.partSource);
  const normalizedGeneratedCondition = normalizeCondition(specifics.condition || specifics.qualityTier);
  return Boolean(
    (source && normalizedGeneratedSource && source === normalizedGeneratedSource) ||
    (condition && normalizedGeneratedCondition && condition === normalizedGeneratedCondition),
  );
}

function approvalGate(part, generated, imageHealth, hasImage) {
  const brand = getBrand(part);
  const mpn = getMpn(part);
  const reasons = [];
  const contradictions = asArray(generated?.contradictions).map(text).filter(Boolean);
  const unresolvedContradictions = contradictions.filter(
    (item) => !authorityConflictIsResolvable(part, generated, item),
  );
  const identityHigh = String(generated?.identityConfidence || '').toUpperCase() === 'HIGH';
  const imageMatch = !hasImage || String(generated?.imageAssessment || '').toUpperCase() === 'MATCH';
  const imageUsable = !hasImage || imageHealth.status === 'valid';
  const imageConfirmed = !hasImage || (imageMatch && String(generated?.imageConfidence || '').toUpperCase() === 'HIGH');
  const modelReviewIsImageOnly = String(generated?.decision || '').toUpperCase() !== 'APPROVE'
    && String(generated?.imageAssessment || '').toUpperCase() === 'UNCERTAIN'
    && unresolvedContradictions.length === 0;
  const contentApproved = Boolean(
    brand && mpn && identityHigh && imageUsable && !unresolvedContradictions.length
      && (String(generated?.decision || '').toUpperCase() === 'APPROVE' || modelReviewIsImageOnly),
  );
  if (!brand) reasons.push('missing brand');
  if (!mpn) reasons.push('missing manufacturer part number/OE number');
  if (!imageUsable) reasons.push('current primary image failed direct validation');
  if (!identityHigh) reasons.push('identity confidence is not HIGH');
  if (unresolvedContradictions.length) reasons.push(...unresolvedContradictions);
  if (hasImage && !imageMatch) reasons.push('image is not a confirmed exact match');
  if (hasImage && String(generated?.imageConfidence || '').toUpperCase() !== 'HIGH') reasons.push('image confidence is not HIGH');
  return {
    approved: contentApproved && imageConfirmed,
    contentApproved,
    imageConfirmed,
    reasons: [...new Set(reasons)],
  };
}

async function fetchParts(client) {
  const idFilter = IDS.length ? 'AND cp.id = ANY($1::text[])' : '';
  const campaignFilter = FORCE ? '' : `AND COALESCE(cp."enrichmentSource", '') <> '${SOURCE}'`;
  const limitSql = LIMIT == null ? '' : `LIMIT ${Math.max(0, LIMIT)}`;
  const offsetSql = OFFSET ? `OFFSET ${Math.max(0, OFFSET)}` : '';
  const result = await client.query(`
    SELECT cp.id, cp.title, cp.brand, cp.manufacturer, cp."manufacturerPartNumber",
      cp."genuineOemPartNumber", cp."oeNumbers", cp.category, cp."categoryGroup",
      cp."partType", cp."partSource", cp."qualityTier", cp.position, cp."vehicleSystem",
      cp.material, cp.description, cp."itemSpecifics", cp.compatibility,
      cp."fitmentStatus", cp."fitmentConfidence", cp."imageUrls", cp."enrichmentStatus",
      cp."enrichmentVersion", cp."enrichmentSource", cp."updatedAt",
      so.condition AS "offerCondition", so."partSource" AS "offerPartSource",
      so."qualityTier" AS "offerQualityTier", so."sellerSku", so."sellerTitle"
    FROM "CanonicalPart" cp
    JOIN LATERAL (
      SELECT condition, "partSource", "qualityTier", "sellerSku", "sellerTitle"
      FROM "SellerOffer"
      WHERE "canonicalPartId" = cp.id
        AND "sellerId" = 'seller-superior-auto-parts'
        AND status = 'ACTIVE'
      ORDER BY "updatedAt" DESC
      LIMIT 1
    ) so ON TRUE
    WHERE (COALESCE(array_length(cp."imageUrls", 1), 0) > 0 OR ${INCLUDE_NO_IMAGE ? 'TRUE' : 'FALSE'})
      ${campaignFilter}
      ${idFilter}
    ORDER BY cp.id
    ${limitSql} ${offsetSql}
  `, IDS.length ? [IDS] : []);
  return result.rows;
}

async function updateApproved(client, part, content, primaryImageUrl, oeNumbers) {
  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE "CanonicalPart" SET
         title = $2,
         description = $3,
         "itemSpecifics" = $4::jsonb,
         "oeNumbers" = $6::text[],
         "enrichmentStatus" = 'DONE',
         "enrichmentVersion" = COALESCE("enrichmentVersion", 0) + 1,
         "enrichmentSource" = $5,
         "enrichedAt" = now(),
         "updatedAt" = now()
       WHERE id = $1
         AND EXISTS (
           SELECT 1 FROM "SellerOffer"
           WHERE "canonicalPartId" = $1 AND "sellerId" = 'seller-superior-auto-parts' AND status = 'ACTIVE'
         )`,
      [part.id, content.title, content.description, JSON.stringify(content.itemSpecifics), SOURCE, oeNumbers],
    );
    await client.query(
      `UPDATE "ProductMedia"
       SET "altText" = $2
       WHERE "canonicalPartId" = $1 AND url = $3`,
      [part.id, `${getBrand(part)} ${content.title} product image`.trim(), primaryImageUrl],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY is required');

  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = process.env.ENHANCE_BACKUP_PATH || `/tmp/superior-imaged-luna-backup-${stamp}.jsonl`;
  const reportPath = process.env.ENHANCE_REPORT_PATH || `/tmp/superior-imaged-luna-report-${stamp}.jsonl`;

  try {
    const parts = await fetchParts(client);
    await fs.writeFile(backupPath, `${parts.map((part) => JSON.stringify(part)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'start', model: MODEL, source: SOURCE, total: parts.length, limit: LIMIT, offset: OFFSET, concurrency: CONCURRENCY, includeNoImage: INCLUDE_NO_IMAGE, dryRun: DRY_RUN, backupPath, reportPath }));

    const reports = [];
    let cursor = 0;
    let completed = 0;
    let approved = 0;
    let contentUpdated = 0;
    let reviewed = 0;
    let failed = 0;

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= parts.length) return;
        const part = parts[index];
        const primaryImageUrl = normalizeUrl(asArray(part.imageUrls)[0]);
        const row = {
          id: part.id,
          partsbazar360ProductUrl: `https://partsbazar360.com/buyer/part/${part.id}/`,
          beforeTitle: part.title,
          primaryImageUrl,
          status: 'started',
        };
        try {
          const hasImage = Boolean(primaryImageUrl);
          const imageHealth = hasImage ? await validateImageUrl(primaryImageUrl) : { status: 'missing_image' };
          row.imageHealth = imageHealth;
          if (!hasImage && !INCLUDE_NO_IMAGE) {
            row.decision = 'REVIEW';
            row.reviewReason = 'no image and no-image processing is disabled';
            row.status = 'review';
            reviewed++;
          } else {
            const { result, usage } = await callLuna(part, primaryImageUrl, imageHealth);
            row.luna = result;
            row.usage = usage;
            const gate = approvalGate(part, result, imageHealth, hasImage);
            row.decision = gate.approved ? 'APPROVE' : 'REVIEW';
            row.reviewReason = gate.reasons.join('; ');
            if (gate.contentApproved) {
              const content = addSeoEvidence(
                mergeContent(part, result),
                result,
                gate,
                hasImage,
                imageHealth,
              );
              row.proposedTitle = content.title;
              row.proposedDescription = content.description;
              row.proposedItemSpecifics = content.itemSpecifics;
              if (!DRY_RUN) await updateApproved(client, part, content, primaryImageUrl, distinctOeNumbers(part));
              row.status = DRY_RUN ? (gate.approved ? 'dry_run_approved' : 'dry_run_content_review_image') : (gate.approved ? 'updated' : 'updated_content_review_image');
              contentUpdated++;
              if (gate.approved) approved++;
            } else {
              row.status = 'review';
              reviewed++;
            }
          }
        } catch (error) {
          failed++;
          row.status = 'failed';
          row.error = error?.message || String(error);
        }
        reports.push(row);
        completed++;
        if (completed === 1 || completed % 100 === 0 || completed === parts.length) {
          console.log(JSON.stringify({ event: 'progress', completed, total: parts.length, approved, contentUpdated, reviewed, failed, productUrl: row.partsbazar360ProductUrl }));
        }
        if (DELAY_MS) await sleep(DELAY_MS);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, parts.length)) }, worker));
    await fs.writeFile(reportPath, `${reports.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'done', total: parts.length, approved, contentUpdated, reviewed, failed, dryRun: DRY_RUN, backupPath, reportPath }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
