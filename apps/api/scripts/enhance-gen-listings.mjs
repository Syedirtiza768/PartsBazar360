#!/usr/bin/env node

/**
 * Production-safe enhancement pass for active Superior GEN listings.
 *
 * The worker deliberately separates evidence-backed work from inference:
 * - Images are accepted only when a web image result contains the exact brand
 *   and manufacturer part number in its indexed evidence.
 * - GPT output may improve title, description, and item specifics, but may not
 *   invent fitment, dimensions, material, warranty, or OEM status.
 * - MVL verification uses existing compatibility rows only. It never creates
 *   vehicle fitment from a generic part title or brand alone.
 *
 * Usage (inside the API container):
 *   node scripts/enhance-gen-listings.mjs --limit 25
 *   node scripts/enhance-gen-listings.mjs
 *
 * Environment:
 *   DATABASE_URL, OPENROUTER_API_KEY
 *   ENHANCE_MODEL (default openai/gpt-5.6-luna)
 *   ENHANCE_CONCURRENCY (default 3)
 *   ENHANCE_DELAY_MS (default 250)
 *   ENHANCE_SOURCE (default gpt-5.6-luna:gen-seo-v1)
 *   ENHANCE_BACKUP_PATH, ENHANCE_REPORT_PATH
 *   ENHANCE_DRY_RUN=1 to call lookup/model but perform no writes
 *   ENHANCE_FORCE=1 to reprocess rows from the same campaign
 *   ENHANCE_IMAGE_ONLY=1 to fetch exact-match images without calling the model
 */
import fs from 'node:fs/promises';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';

const MODEL = process.env.ENHANCE_MODEL || 'openai/gpt-5.6-luna';
const SOURCE = process.env.ENHANCE_SOURCE || 'gpt-5.6-luna:gen-seo-v1';
const CONCURRENCY = Math.max(1, Number(process.env.ENHANCE_CONCURRENCY || 3));
const DELAY_MS = Math.max(0, Number(process.env.ENHANCE_DELAY_MS || 250));
const LIMIT = readNumberArg('--limit');
const OFFSET = readNumberArg('--offset') || 0;
const DRY_RUN = process.env.ENHANCE_DRY_RUN === '1';
const FORCE = process.env.ENHANCE_FORCE === '1';
const IMAGE_ONLY = process.env.ENHANCE_IMAGE_ONLY === '1';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const IMAGE_USER_AGENT =
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
  return String(value ?? '')
    .replace(/```(?:json|text)?/gi, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(value, fallback) {
  const title = cleanText(value || fallback).replace(/[<>]/g, '');
  return title.length <= 80 ? title : `${title.slice(0, 77).trimEnd()}...`;
}

function cleanDescription(value, fallback) {
  const description = String(value || fallback || '')
    .replace(/```(?:json|text)?/gi, '')
    .replace(/```/g, '')
    .replace(/\r/g, '')
    .trim();
  return description.length <= 1800 ? description : `${description.slice(0, 1797).trimEnd()}...`;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(content) {
  const cleaned = String(content || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('model returned no JSON object');
  return JSON.parse(match[0]);
}

function getMpn(part) {
  if (part.manufacturerPartNumber) return String(part.manufacturerPartNumber).trim();
  const oe = asArray(part.oeNumbers).find(Boolean);
  if (oe) return String(oe).trim();
  const match = String(part.title || '').match(/(?:-|\s)\s*([A-Z0-9][A-Z0-9./_-]{3,})\s*(?:-|$)/i);
  return match?.[1] || '';
}

function getBrand(part) {
  const brand = String(part.brand || '').trim();
  return brand && !/^unknown$/i.test(brand) ? brand : '';
}

function normalizeCondition(value) {
  const raw = String(value || '').toUpperCase();
  if (raw.includes('REMAN')) return 'Remanufactured';
  if (raw.includes('REFURB')) return 'Refurbished';
  if (raw.includes('USED')) return 'Used';
  if (raw.includes('NEW')) return 'New';
  return null;
}

function normalizePartSource(value) {
  const raw = String(value || '').toUpperCase();
  if (raw.includes('AFTER')) return 'Aftermarket';
  if (raw.includes('OEM')) return 'OEM';
  return null;
}

function summarizeCompatibility(value) {
  return asArray(value)
    .filter((row) => row && row.verified === true && row.make && row.model && row.year)
    .slice(0, 8)
    .map((row) => ({
      year: row.year,
      make: row.make,
      model: row.model,
      trim: row.trim || null,
      engine: row.engine || null,
    }));
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': IMAGE_USER_AGENT,
      Accept: 'application/json,text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options.headers || {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs || 25_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

const imageLookupCache = new Map();

async function lookupExactImage(brand, mpn) {
  const key = `${normalizeToken(brand)}|${normalizeToken(mpn)}`;
  if (!key.replace('|', '')) return { status: 'missing_evidence' };
  if (imageLookupCache.has(key)) return imageLookupCache.get(key);

  const result = await (async () => {
    if (!brand || !mpn || !normalizeToken(brand) || !normalizeToken(mpn)) {
      return { status: 'missing_evidence' };
    }

    const query = `${brand} ${mpn}`;
    const landing = await fetchText(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
    const landingHtml = await landing.text();
    const token = /vqd=['"]?([^'"&]+)/i.exec(landingHtml)?.[1];
    if (!token) return { status: 'no_search_token' };

    const response = await fetchText(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(token)}`,
    );
    const payload = await response.json();
    const candidates = Array.isArray(payload?.results) ? payload.results : [];
    const nBrand = normalizeToken(brand);
    const nMpn = normalizeToken(mpn);
    const matches = candidates
      .filter((candidate) => {
        const image = normalizeUrl(candidate?.image);
        const evidence = normalizeToken(
          `${candidate?.title || ''} ${candidate?.url || ''} ${candidate?.source || ''}`,
        );
        return isImageUrl(image) && evidence.includes(nBrand) && evidence.includes(nMpn);
      })
      .map((candidate) => {
        const image = normalizeUrl(candidate.image);
        const evidence = normalizeToken(
          `${candidate.title || ''} ${candidate.url || ''} ${candidate.source || ''}`,
        );
        let score = 0;
        if (normalizeToken(candidate.title).includes(nBrand)) score += 4;
        if (normalizeToken(candidate.title).includes(nMpn)) score += 5;
        if (normalizeToken(candidate.url).includes(nMpn)) score += 3;
        if (candidate.width && candidate.height) score += 1;
        return {
          score,
          imageUrl: image,
          sourceUrl: candidate.url || null,
          source: candidate.source || null,
          evidence,
        };
      })
      .sort((a, b) => b.score - a.score);

    return matches[0]
      ? { status: 'matched', ...matches[0] }
      : { status: 'no_exact_match' };
  })().catch((error) => ({ status: 'error', error: error.message || String(error) }));

  imageLookupCache.set(key, result);
  return result;
}

function buildPrompt(part, image) {
  const offerCondition = normalizeCondition(part.offerCondition) || normalizeCondition(part.qualityTier);
  const offerSource = normalizePartSource(part.offerPartSource || part.partSource);
  const offerQuality = String(part.offerQualityTier || part.qualityTier || '').trim() || null;
  const evidence = {
    currentTitle: part.title,
    brand: part.brand || null,
    manufacturerPartNumber: part.manufacturerPartNumber || getMpn(part) || null,
    oeNumbers: asArray(part.oeNumbers).slice(0, 12),
    category: part.category || null,
    categoryGroup: part.categoryGroup || null,
    partType: part.partType || null,
    currentDescription: String(part.description || '').slice(0, 900),
    currentItemSpecifics: asObject(part.itemSpecifics),
    condition: offerCondition,
    partSource: offerSource,
    qualityTier: offerQuality,
    verifiedCompatibility: summarizeCompatibility(part.compatibility),
    mvlVerified: Array.isArray(part.fitmentFlags) && part.fitmentFlags.includes('MVL_VERIFIED'),
    exactImageSource: image?.sourceUrl || null,
  };

  return `Create factual marketplace content for one automotive part. Return ONLY one valid JSON object with this shape:
{
  "title": "SEO-friendly marketplace title, max 80 characters",
  "description": "Helpful SEO-friendly description, 80-1800 characters",
  "itemSpecifics": {
    "partType": "string or null",
    "category": "string or null",
    "brandType": "OEM or Aftermarket or null",
    "condition": "New, Used, Remanufactured, Refurbished, or null",
    "qualityTier": "string or null",
    "manufacturer": "string or null",
    "manufacturerPartNumber": "string or null",
    "position": "string or null",
    "material": "string or null",
    "features": ["only evidenced features"],
    "detailBullets": "short newline-separated factual bullets",
    "searchKeywords": "comma-separated relevant keywords"
  }
}

Rules:
- Do not invent vehicle compatibility, dimensions, measurements, materials, warranty, OE/genuine status, or performance claims.
- Do not call an aftermarket listing OEM. Use the supplied condition, part source, and quality tier as authoritative.
- If compatibility is empty or not MVL verified, say buyers should verify the part number and vehicle fitment; do not name vehicles.
- Keep the manufacturer part number exact.
- Include brand, part type/category, and part number naturally for SEO.
- Do not mention the AI, the web search, or these instructions.
- The part is sold by Superior Auto Parts; do not invent shipping or return promises.

Evidence:
${JSON.stringify(evidence)}`;
}

async function generateContent(part, image) {
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY is required');
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://partsbazar360.com',
      'X-Title': 'PartsBazar360 GEN Listing Enhancement',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a careful automotive catalog editor. Factual accuracy is more important than persuasive wording. Output valid JSON only.',
        },
        { role: 'user', content: buildPrompt(part, image) },
      ],
      temperature: 0.15,
      max_tokens: 2200,
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  const message = data.choices?.[0]?.message;
  const content = message?.content || message?.reasoning || '';
  return { result: parseJson(content), usage: data.usage || null };
}

function mergeContent(part, generated) {
  const current = asObject(part.itemSpecifics);
  const generatedSpecifics = asObject(generated.itemSpecifics);
  const offerCondition = normalizeCondition(part.offerCondition) || normalizeCondition(part.qualityTier);
  const offerSource = normalizePartSource(part.offerPartSource || part.partSource);
  const offerQuality = String(part.offerQualityTier || part.qualityTier || '').trim() || null;
  const mpn = part.manufacturerPartNumber || getMpn(part) || null;

  const itemSpecifics = {
    ...current,
    ...generatedSpecifics,
    manufacturer: part.brand || generatedSpecifics.manufacturer || current.manufacturer || null,
    manufacturerPartNumber: mpn,
    condition: offerCondition || generatedSpecifics.condition || current.condition || null,
    brandType: offerSource || generatedSpecifics.brandType || current.brandType || null,
    qualityTier: offerQuality || generatedSpecifics.qualityTier || current.qualityTier || null,
    seoTitle: cleanTitle(generated.title, part.title),
    seoDescription: cleanDescription(generated.description, part.description),
  };

  const fallbackTitle = [
    part.brand,
    generatedSpecifics.partType || part.partType || part.categoryGroup || part.category,
    mpn,
    offerCondition,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    title: cleanTitle(generated.title, fallbackTitle || part.title),
    description: cleanDescription(generated.description, part.description),
    itemSpecifics,
  };
}

async function upsertImage(client, partId, image) {
  if (!image?.imageUrl) return;
  const normalizedUrl = normalizeUrl(image.imageUrl);
  await client.query(
    `INSERT INTO "ProductMedia"
      (id, "canonicalPartId", url, "normalizedUrl", "sortOrder", "isPrimary", "isActualItem", "mediaType", "importStatus", "altText", "sourceUrl", "createdAt")
     VALUES ($1,$2,$3,$3,0,true,false,'IMAGE','IMPORTED',$4,$5,now())
     ON CONFLICT ("canonicalPartId", "normalizedUrl") DO UPDATE SET
       "isPrimary"=true, "altText"=EXCLUDED."altText", "sourceUrl"=EXCLUDED."sourceUrl"`,
    [
      randomUUID(),
      partId,
      normalizedUrl,
      'Product image for exact brand and manufacturer part number match',
      image.sourceUrl || null,
    ],
  );
}

async function updatePart(client, part, content, image) {
  const currentImages = asArray(part.imageUrls).filter(isImageUrl);
  const nextImages = currentImages.length > 0 || !image?.imageUrl
    ? currentImages
    : [normalizeUrl(image.imageUrl)];

  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE "CanonicalPart" SET
         title=$2,
         description=$3,
         "itemSpecifics"=$4::jsonb,
         "imageUrls"=$5::text[],
         "enrichmentStatus"='DONE',
         "enrichedAt"=now(),
         "enrichmentSource"=$6,
         "updatedAt"=now()
       WHERE id=$1`,
      [part.id, content.title, content.description, JSON.stringify(content.itemSpecifics), nextImages, SOURCE],
    );
    if (image?.imageUrl && currentImages.length === 0) await upsertImage(client, part.id, image);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return { imageAdded: currentImages.length === 0 && nextImages.length > 0 };
}

async function updateImageOnly(client, part, image) {
  const currentImages = asArray(part.imageUrls).filter(isImageUrl);
  if (currentImages.length > 0 || !image?.imageUrl) return { imageAdded: false };
  const nextImage = normalizeUrl(image.imageUrl);

  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE "CanonicalPart" SET
         "imageUrls"=$2::text[],
         "updatedAt"=now()
       WHERE id=$1`,
      [part.id, [nextImage]],
    );
    await upsertImage(client, part.id, image);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return { imageAdded: true };
}

async function verifyMvl(client, part) {
  if (asArray(part.fitmentFlags).includes('MVL_VERIFIED')) return { status: 'already_verified' };
  const candidates = summarizeCompatibility(part.compatibility);
  if (!candidates.length) return { status: 'no_existing_compatibility' };

  const verified = [];
  for (const candidate of candidates) {
    const rows = await client.query(
      `SELECT make, model, epid, "kType", trim, engine, market
       FROM "MvlVehicle"
       WHERE year=$1 AND "normalizedMake"=$2 AND "normalizedModel"=$3
         AND market IN ('US','DE','UK','AU')
       ORDER BY CASE market WHEN 'US' THEN 1 WHEN 'DE' THEN 2 WHEN 'UK' THEN 3 ELSE 4 END
       LIMIT 1`,
      [candidate.year, normalizeToken(candidate.make), normalizeToken(candidate.model)],
    );
    const hit = rows.rows[0];
    if (!hit) continue;
    verified.push({
      year: candidate.year,
      make: hit.make,
      model: hit.model,
      trim: candidate.trim || hit.trim || '-',
      engine: candidate.engine || hit.engine || '-',
      market: hit.market || 'US',
      source: 'MVL_MATCH',
      epid: hit.epid || null,
      verified: true,
    });
  }
  if (!verified.length) return { status: 'no_mvl_match' };

  const configIds = [];
  for (const vehicle of verified) {
    await client.query(
      `INSERT INTO "VehicleMake" (id,name,"canonicalName","displayName")
       VALUES ($1,$2,$2,$2) ON CONFLICT (name) DO NOTHING`,
      [randomUUID(), vehicle.make],
    );
    const make = (await client.query(`SELECT id FROM "VehicleMake" WHERE name=$1`, [vehicle.make])).rows[0];
    let model = (await client.query(`SELECT id FROM "VehicleModel" WHERE "makeId"=$1 AND name=$2 LIMIT 1`, [make.id, vehicle.model])).rows[0];
    if (!model) {
      model = (await client.query(
        `INSERT INTO "VehicleModel" (id,"makeId",name) VALUES ($1,$2,$3) RETURNING id`,
        [randomUUID(), make.id, vehicle.model],
      )).rows[0];
    }
    let generation = (await client.query(
      `SELECT id FROM "VehicleGeneration"
       WHERE "modelId"=$1 AND "startYear" <= $2 AND ("endYear" >= $2 OR "endYear" IS NULL)
       ORDER BY "startYear" DESC LIMIT 1`,
      [model.id, vehicle.year],
    )).rows[0];
    if (!generation) {
      generation = (await client.query(
        `INSERT INTO "VehicleGeneration" (id,"modelId",name,"startYear","endYear")
         VALUES ($1,$2,$3,$4,$4) RETURNING id`,
        [randomUUID(), model.id, String(vehicle.year), vehicle.year],
      )).rows[0];
    }
    let configuration = vehicle.epid
      ? (await client.query(`SELECT id FROM "VehicleConfiguration" WHERE epid=$1`, [vehicle.epid])).rows[0]
      : null;
    if (!configuration) {
      configuration = (await client.query(
        `SELECT id FROM "VehicleConfiguration"
         WHERE "generationId"=$1 AND market IS NOT DISTINCT FROM $2
           AND trim IS NOT DISTINCT FROM $3 AND engine IS NOT DISTINCT FROM $4
         LIMIT 1`,
        [generation.id, vehicle.market || 'US', vehicle.trim, vehicle.engine],
      )).rows[0];
    }
    if (!configuration) {
      configuration = (await client.query(
        `INSERT INTO "VehicleConfiguration" (id,"generationId",trim,engine,market,epid)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [randomUUID(), generation.id, vehicle.trim, vehicle.engine, vehicle.market || 'US', vehicle.epid],
      )).rows[0];
    }
    configIds.push(configuration.id);
  }

  const uniqueConfigIds = [...new Set(configIds)];
  for (const configId of uniqueConfigIds) {
    const fitmentId = randomUUID();
    const result = await client.query(
      `INSERT INTO "Fitment"
        (id,"canonicalPartId","vehicleConfigId","evidenceLevel",confidence,reviewer,source,"verificationStatus",reason,"createdAt","updatedAt")
       VALUES ($1,$2,$3,'B',0.9,'Auto (MVL verified)','MVL_BACKFILL','VERIFIED','Matched existing compatibility row to MVL',now(),now())
       ON CONFLICT ("canonicalPartId","vehicleConfigId") DO UPDATE SET
         evidenceLevel='B', confidence=0.9, reviewer='Auto (MVL verified)', source='MVL_BACKFILL',
         "verificationStatus"='VERIFIED', reason='Matched existing compatibility row to MVL', "updatedAt"=now()
       RETURNING id`,
      [fitmentId, part.id, configId],
    );
    await client.query(
      `INSERT INTO "FitmentEvidence"
        (id,"fitmentId","evidenceType","evidenceLevel",confidence,source,"verifiedBy","verifiedAt","createdAt")
       VALUES ($1,$2,'MVL_MATCH','B',0.9,'MVL_BACKFILL','Auto (MVL verified)',now(),now())`,
      [randomUUID(), result.rows[0].id],
    );
  }

  const flags = [...new Set([...asArray(part.fitmentFlags), 'MVL_VERIFIED'])];
  await client.query(
    `UPDATE "CanonicalPart" SET compatibility=$2::jsonb,"fitmentStatus"='CONFIRMED',"fitmentConfidence"=0.9,"fitmentFlags"=$3::text[],"updatedAt"=now() WHERE id=$1`,
    [part.id, JSON.stringify(verified), flags],
  );
  return { status: 'verified', count: uniqueConfigIds.length };
}

async function fetchParts(client) {
  const campaignFilter = IMAGE_ONLY || FORCE ? '' : `AND COALESCE(cp."enrichmentSource", '') NOT LIKE '${SOURCE}%'`;
  const imageFilter = IMAGE_ONLY ? `AND COALESCE(array_length(cp."imageUrls", 1), 0)=0` : '';
  const ids = String(process.env.ENHANCE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const idFilter = ids.length ? 'AND cp.id = ANY($1::text[])' : '';
  const limitSql = LIMIT == null ? '' : `LIMIT ${Math.max(0, LIMIT)}`;
  const offsetSql = OFFSET ? `OFFSET ${Math.max(0, OFFSET)}` : '';
  const result = await client.query(`
    SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber", cp."oeNumbers", cp.category,
      cp."categoryGroup", cp."partType", cp.description, cp."itemSpecifics", cp."imageUrls",
      cp.compatibility, cp."fitmentStatus", cp."fitmentFlags", cp."qualityTier", cp."partSource",
      cp.position, cp.material, cp."enrichmentStatus", cp."enrichmentSource",
      so.condition AS "offerCondition", so."partSource" AS "offerPartSource",
      so."qualityTier" AS "offerQualityTier", so."sellerTitle", so."sellerNotes"
    FROM "CanonicalPart" cp
    JOIN LATERAL (
      SELECT condition, "partSource", "qualityTier", "sellerTitle", "sellerNotes"
      FROM "SellerOffer"
      WHERE "canonicalPartId"=cp.id AND "sourceTag"='GEN' AND status='ACTIVE'
      ORDER BY "updatedAt" DESC
      LIMIT 1
    ) so ON TRUE
    WHERE TRUE ${campaignFilter} ${idFilter} ${imageFilter}
    ORDER BY cp.id
    ${limitSql} ${offsetSql}`, ids.length ? [ids] : []);
  return result.rows;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!OPENROUTER_KEY && !DRY_RUN && !IMAGE_ONLY) throw new Error('OPENROUTER_API_KEY is required');

  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = process.env.ENHANCE_BACKUP_PATH || `/tmp/gen-enhancement-backup-${stamp}.jsonl`;
  const reportPath = process.env.ENHANCE_REPORT_PATH || `/tmp/gen-enhancement-report-${stamp}.jsonl`;

  try {
    const parts = await fetchParts(client);
    await fs.writeFile(backupPath, `${parts.map((part) => JSON.stringify(part)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'start', model: MODEL, source: SOURCE, total: parts.length, limit: LIMIT, offset: OFFSET, concurrency: CONCURRENCY, dryRun: DRY_RUN, imageOnly: IMAGE_ONLY, backupPath, reportPath }));

    const results = [];
    let cursor = 0;
    let completed = 0;
    let contentUpdated = 0;
    let imageUpdated = 0;
    let mvlVerified = 0;
    let failed = 0;

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= parts.length) return;
        const part = parts[index];
        const brand = getBrand(part);
        const mpn = getMpn(part);
        const row = { id: part.id, beforeTitle: part.title, status: 'started' };
        try {
          const image = asArray(part.imageUrls).some(isImageUrl)
            ? { status: 'existing_image' }
            : await lookupExactImage(brand, mpn);
          row.imageStatus = image.status;
          row.imageUrl = image.imageUrl || null;

          let generated = null;
          let content = null;
          if (OPENROUTER_KEY && !IMAGE_ONLY) {
            generated = await generateContent(part, image);
            content = mergeContent(part, generated.result);
          }

          if (!DRY_RUN && content) {
            const update = await updatePart(client, part, content, image);
            if (update.imageAdded) imageUpdated++;
            contentUpdated++;
            row.title = content.title;
            row.imageAdded = update.imageAdded;
          }

          if (!DRY_RUN && IMAGE_ONLY && image?.imageUrl) {
            const update = await updateImageOnly(client, part, image);
            if (update.imageAdded) imageUpdated++;
            row.imageAdded = update.imageAdded;
          }

          if (!DRY_RUN && !IMAGE_ONLY) {
            const mvl = await verifyMvl(client, part);
            row.mvlStatus = mvl.status;
            if (mvl.status === 'verified') mvlVerified++;
          } else if (!DRY_RUN && IMAGE_ONLY) {
            row.mvlStatus = 'not_run_image_only';
          } else {
            row.mvlStatus = 'dry_run';
          }
          row.status = DRY_RUN ? 'dry_run' : 'updated';
          row.usage = generated?.usage || null;
        } catch (error) {
          failed++;
          row.status = 'failed';
          row.error = error?.message || String(error);
        }
        results.push(row);
        completed++;
        if (completed % 10 === 0 || completed === parts.length) {
          console.log(JSON.stringify({ event: 'progress', completed, total: parts.length, contentUpdated, imageUpdated, mvlVerified, failed }));
        }
        if (DELAY_MS) await sleep(DELAY_MS);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, parts.length)) }, worker));
    await fs.writeFile(reportPath, `${results.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'done', total: parts.length, contentUpdated, imageUpdated, mvlVerified, failed, imageOnly: IMAGE_ONLY, backupPath, reportPath }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
