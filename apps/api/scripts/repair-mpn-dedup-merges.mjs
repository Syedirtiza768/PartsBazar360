#!/usr/bin/env node
/**
 * Repair the 2026-08-01 MPN-only catalog merge pass.
 *
 * The old pass redirected products whenever normalized MPNs matched. That is
 * unsafe when brand, part type, source, or position differs. This utility is
 * deliberately dry-run by default:
 *
 *   node scripts/repair-mpn-dedup-merges.mjs
 *   APPLY=1 node scripts/repair-mpn-dedup-merges.mjs
 *
 * It only removes redirects with a structured identity blocker. It restores
 * offers using retained upload-row candidate IDs or an exact seller-title
 * match, moves brand-scoped part numbers back to their source product, moves
 * source lineage rows, records an audit event, and queues both products for
 * search reindexing. Ambiguous mappings are reported and left untouched.
 */
import { randomUUID } from 'node:crypto';
import { Client as PgClient } from 'pg';

const APPLY = process.env.APPLY === '1';
const LIMIT = Math.max(0, Number(process.env.REPAIR_LIMIT || 0));
const REPORT_PATH = process.env.REPAIR_REPORT || '';
const ACTOR = process.env.REPAIR_ACTOR || 'system:mpn-dedup-repair-2026-08-14';
const NON_BRAND_LABELS = new Set([
  'GENUINEOEM',
  'OEM',
  'OE',
  'ORIGINAL',
  'AFTERMARKET',
  'NEW',
  'USED',
]);
const BRAND_EQUIVALENTS = new Map([
  ['MERCEDES', 'MERCEDESBENZ'],
  ['MERCEDESBENZ', 'MERCEDESBENZ'],
  ['BENZ', 'MERCEDESBENZ'],
  ['VOLKSWAGEN', 'VOLKSWAGEN'],
  ['VOLKWAGEN', 'VOLKSWAGEN'],
  ['VOLKSWAGON', 'VOLKSWAGEN'],
  ['VW', 'VOLKSWAGEN'],
  ['LANDROVER', 'LANDROVER'],
  ['RANGEROVER', 'LANDROVER'],
]);

function text(value) {
  return String(value ?? '').trim();
}

function identity(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function partNumberKey(value) {
  return text(value)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function meaningful(value, ignored = []) {
  const normalized = identity(value);
  return normalized && !ignored.includes(normalized) ? normalized : null;
}

function brandKey(value, brandMap) {
  const key = identity(value);
  if (!key || NON_BRAND_LABELS.has(key)) return null;
  // Prefer explicit, curated equivalences over database IDs. Historical
  // imports created separate BrandMaster rows for common spelling variants;
  // comparing those IDs would reclassify harmless label variants as a brand
  // split.
  return BRAND_EQUIVALENTS.get(key) || brandMap.get(key) || key;
}

function blockersFor(source, target, brandMap) {
  const blockers = [];
  const sourceBrand = brandKey(source.brand, brandMap);
  const targetBrand = brandKey(target.brand, brandMap);
  if (sourceBrand && targetBrand && sourceBrand !== targetBrand) {
    blockers.push(`brand:${source.brand}!=${target.brand}`);
  }

  const sourcePartSource = meaningful(source.partSource);
  const targetPartSource = meaningful(target.partSource);
  if (
    sourcePartSource &&
    targetPartSource &&
    sourcePartSource !== targetPartSource
  ) {
    blockers.push(`partSource:${source.partSource}!=${target.partSource}`);
  }

  const sourceType = meaningful(source.partType, ['UNCLASSIFIED']);
  const targetType = meaningful(target.partType, ['UNCLASSIFIED']);
  if (sourceType && targetType && sourceType !== targetType) {
    blockers.push(`partType:${source.partType}!=${target.partType}`);
  }

  const sourcePosition = meaningful(source.position);
  const targetPosition = meaningful(target.position);
  if (sourcePosition && targetPosition && sourcePosition !== targetPosition) {
    blockers.push(`position:${source.position}!=${target.position}`);
  }

  return blockers;
}

function addBrand(map, value, id) {
  const key = identity(value);
  if (key && id && !map.has(key)) map.set(key, id);
}

async function queryReport(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

async function loadBrandMap(client) {
  const map = new Map();
  const { rows } = await client.query(`
    SELECT bm.id, bm."canonicalName", bm."displayName", ba.alias
    FROM "BrandMaster" bm
    LEFT JOIN "BrandAlias" ba ON ba."brandId" = bm.id
  `);
  for (const row of rows) {
    addBrand(map, row.canonicalName, row.id);
    addBrand(map, row.displayName, row.id);
    addBrand(map, row.alias, row.id);
  }
  return map;
}

async function loadRedirects(client) {
  const { rows } = await client.query(`
    SELECT
      r.id AS "redirectId",
      r."fromPartId" AS "fromPartId",
      r."toPartId" AS "toPartId",
      r.reason,
      r."createdAt",
      src.title AS "sourceTitle",
      src.brand AS "sourceBrand",
      src."primaryBrandId" AS "sourceBrandId",
      src."manufacturerPartNumber" AS "sourceMpn",
      src."partType" AS "sourcePartType",
      src."partSource" AS "sourcePartSource",
      src.position AS "sourcePosition",
      dst.title AS "targetTitle",
      dst.brand AS "targetBrand",
      dst."primaryBrandId" AS "targetBrandId",
      dst."manufacturerPartNumber" AS "targetMpn",
      dst."partType" AS "targetPartType",
      dst."partSource" AS "targetPartSource",
      dst.position AS "targetPosition"
    FROM "CanonicalPartRedirect" r
    JOIN "CanonicalPart" src ON src.id = r."fromPartId"
    JOIN "CanonicalPart" dst ON dst.id = r."toPartId"
    WHERE r.reason = 'mpn-dedup'
    ORDER BY r."createdAt", r.id
  `);
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

async function loadTargetPartNumbers(client) {
  const { rows } = await client.query(`
    SELECT
      pn.id,
      pn."canonicalPartId",
      pn."brandId",
      pn."normalizedNumber",
      pn."numberType",
      bm."canonicalName" AS "brandCanonicalName",
      bm."displayName" AS "brandDisplayName"
    FROM "CatalogPartNumber" pn
    JOIN (
      SELECT DISTINCT "toPartId"
      FROM "CanonicalPartRedirect"
      WHERE reason = 'mpn-dedup'
    ) affected ON affected."toPartId" = pn."canonicalPartId"
    LEFT JOIN "BrandMaster" bm ON bm.id = pn."brandId"
    WHERE pn."numberType" = 'BRAND_MPN'
  `);
  const byPart = new Map();
  for (const row of rows) {
    const list = byPart.get(row.canonicalPartId) || [];
    list.push(row);
    byPart.set(row.canonicalPartId, list);
  }
  return byPart;
}

async function loadUploadOfferMappings(client) {
  const { rows } = await client.query(`
    SELECT
      ur."matchCandidateId" AS "fromPartId",
      ur."sellerOfferId" AS "offerId",
      so."canonicalPartId" AS "currentPartId",
      so.status,
      so."sellerTitle"
    FROM "SellerUploadRow" ur
    JOIN "CanonicalPartRedirect" r
      ON r."fromPartId" = ur."matchCandidateId"
     AND r.reason = 'mpn-dedup'
    JOIN "SellerOffer" so ON so.id = ur."sellerOfferId"
    WHERE ur."matchCandidateId" IS NOT NULL
      AND ur."sellerOfferId" IS NOT NULL
  `);
  return rows;
}

async function loadTargetOffers(client) {
  const { rows } = await client.query(`
    SELECT
      so.id AS "offerId",
      so."canonicalPartId" AS "currentPartId",
      so."sellerId",
      so."sourceTag",
      so.status,
      so."sellerTitle",
      so."sellerSku",
      so."externalOfferId"
    FROM "SellerOffer" so
    JOIN "CanonicalPartRedirect" r
      ON r."toPartId" = so."canonicalPartId"
     AND r.reason = 'mpn-dedup'
  `);
  return rows;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildOfferPlans(redirects, uploadRows, targetOffers) {
  const uploadByFrom = new Map();
  for (const row of uploadRows) {
    const list = uploadByFrom.get(row.fromPartId) || [];
    list.push({ ...row, method: 'upload-matchCandidateId' });
    uploadByFrom.set(row.fromPartId, list);
  }

  const sourcesByTarget = new Map();
  for (const redirect of redirects) {
    if (!redirect.blockers.length) continue;
    const list = sourcesByTarget.get(redirect.toPartId) || [];
    list.push(redirect);
    sourcesByTarget.set(redirect.toPartId, list);
  }

  // Index source titles by target once. The previous implementation scanned
  // every target offer for every redirect, which became quadratic at the
  // production catalog size.
  const sourceTitleByTarget = new Map();
  for (const [targetId, sources] of sourcesByTarget) {
    const byTitle = new Map();
    for (const source of sources) {
      const key = identity(source.sourceTitle);
      if (!key) continue;
      const matches = byTitle.get(key) || [];
      matches.push(source.fromPartId);
      byTitle.set(key, matches);
    }
    sourceTitleByTarget.set(targetId, byTitle);
  }

  const titleClaimsByFrom = new Map();
  for (const offer of targetOffers) {
    const key = identity(offer.sellerTitle);
    const matches = sourceTitleByTarget.get(offer.currentPartId)?.get(key) || [];
    if (matches.length === 1) {
      const claim = {
        fromPartId: matches[0],
        method: 'exact-seller-title',
        currentPartId: offer.currentPartId,
      };
      const claims = titleClaimsByFrom.get(claim.fromPartId) || [];
      claims.push({ offerId: offer.offerId, ...claim });
      titleClaimsByFrom.set(claim.fromPartId, claims);
    }
  }

  return redirects.map((redirect) => {
    if (!redirect.blockers.length) {
      return { redirect, offerMoves: [], ambiguousOffers: [], offerMethods: {} };
    }

    const claims = new Map();
    for (const row of uploadByFrom.get(redirect.fromPartId) || []) {
      const existing = claims.get(row.offerId) || [];
      existing.push({ fromPartId: redirect.fromPartId, method: row.method, currentPartId: row.currentPartId });
      claims.set(row.offerId, existing);
    }
    for (const match of titleClaimsByFrom.get(redirect.fromPartId) || []) {
      const existing = claims.get(match.offerId) || [];
      existing.push(match);
      claims.set(match.offerId, existing);
    }

    const offerMoves = [];
    const ambiguousOffers = [];
    const offerMethods = {};
    for (const [offerId, entries] of claims) {
      const fromIds = unique(entries.map((entry) => entry.fromPartId));
      if (fromIds.length !== 1) {
        ambiguousOffers.push({ offerId, fromIds });
        continue;
      }
      const currentPartIds = unique(entries.map((entry) => entry.currentPartId));
      if (currentPartIds.some((partId) => partId !== redirect.toPartId && partId !== redirect.fromPartId)) {
        ambiguousOffers.push({ offerId, currentPartIds });
        continue;
      }
      if (currentPartIds.includes(redirect.fromPartId)) continue;
      const method = entries.some((entry) => entry.method === 'upload-matchCandidateId')
        ? 'upload-matchCandidateId'
        : 'exact-seller-title';
      offerMoves.push(offerId);
      offerMethods[offerId] = method;
    }

    return { redirect, offerMoves: unique(offerMoves), ambiguousOffers, offerMethods };
  });
}

function choosePartNumbers(redirect, partNumbersByTarget, brandMap) {
  const sourceBrandId = redirect.sourceBrandId || brandMap.get(identity(redirect.sourceBrand));
  const sourceMpn = partNumberKey(redirect.sourceMpn);
  if (!sourceMpn) return { sourceBrandId, ids: [], reason: 'source MPN missing' };

  const candidates = (partNumbersByTarget.get(redirect.toPartId) || []).filter(
    (row) => partNumberKey(row.normalizedNumber) === sourceMpn,
  );
  const byId = candidates.filter((row) => sourceBrandId && row.brandId === sourceBrandId);
  if (byId.length) return { sourceBrandId, ids: unique(byId.map((row) => row.id)) };

  const sourceBrand = brandKey(redirect.sourceBrand, brandMap);
  const byName = candidates.filter(
    (row) =>
      sourceBrand &&
      (brandKey(row.brandCanonicalName, brandMap) === sourceBrand ||
        brandKey(row.brandDisplayName, brandMap) === sourceBrand),
  );
  if (byName.length) return { sourceBrandId, ids: unique(byName.map((row) => row.id)) };

  return { sourceBrandId, ids: [], reason: sourceBrandId ? 'target brand MPN row missing' : 'brand namespace unresolved' };
}

async function applyPlan(client, plan, numberPlan) {
  const { redirect } = plan;
  await client.query('BEGIN');
  try {
    if (plan.offerMoves.length) {
      await client.query(
        `UPDATE "SellerOffer"
         SET "canonicalPartId" = $1, "updatedAt" = NOW()
         WHERE id = ANY($2::text[])
           AND "canonicalPartId" = $3`,
        [redirect.fromPartId, plan.offerMoves, redirect.toPartId],
      );
      await client.query(
        `UPDATE "SellerUploadRow"
         SET "canonicalPartId" = $1, "updatedAt" = NOW()
         WHERE "sellerOfferId" = ANY($2::text[])
           AND "matchCandidateId" = $1`,
        [redirect.fromPartId, plan.offerMoves],
      );
      await client.query(
        `UPDATE "SourceRecord"
         SET "canonicalPartId" = $1
         WHERE "sellerOfferId" = ANY($2::text[])`,
        [redirect.fromPartId, plan.offerMoves],
      );
    }

    if (numberPlan.ids.length) {
      await client.query(
        `UPDATE "CatalogPartNumber"
         SET "canonicalPartId" = $1, "updatedAt" = NOW()
         WHERE id = ANY($2::text[])`,
        [redirect.fromPartId, numberPlan.ids],
      );
    }

    await client.query(
      `DELETE FROM "CanonicalPartRedirect"
       WHERE id = $1 AND "fromPartId" = $2 AND "toPartId" = $3 AND reason = 'mpn-dedup'`,
      [redirect.redirectId, redirect.fromPartId, redirect.toPartId],
    );

    const metadata = {
      oldRedirectId: redirect.redirectId,
      fromPartId: redirect.fromPartId,
      toPartId: redirect.toPartId,
      blockers: redirect.blockers,
      offerMoves: plan.offerMoves.length,
      offerMethods: Object.values(plan.offerMethods).reduce((counts, method) => {
        counts[method] = (counts[method] || 0) + 1;
        return counts;
      }, {}),
      partNumberMoves: numberPlan.ids.length,
      actor: ACTOR,
    };
    await client.query(
      `INSERT INTO "AuditEvent"
        (id, action, "entityType", "entityId", "actorType", "actorId", source, reason,
         "originalValue", "normalizedValue", metadata, "canonicalPartId")
       VALUES ($1, 'REPAIR_MPN_DEDUP', 'CanonicalPart', $2, 'SYSTEM', $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $2)`,
      [
        randomUUID(),
        redirect.fromPartId,
        ACTOR,
        'MPN_DEDUP_REPAIR',
        'Restored namespace blocked by MPN-only merge',
        JSON.stringify({ sourceTitle: redirect.sourceTitle, targetTitle: redirect.targetTitle }),
        JSON.stringify({ sourceBrand: redirect.sourceBrand, targetBrand: redirect.targetBrand }),
        JSON.stringify(metadata),
      ],
    );

    for (const partId of unique([redirect.fromPartId, redirect.toPartId])) {
      await client.query(
        `INSERT INTO "SearchOutbox"
          (id, "entityType", "entityId", operation, payload, status, "availableAt", "createdAt", "updatedAt")
         VALUES ($1, 'CanonicalPart', $2, 'UPSERT', $3::jsonb, 'PENDING', NOW(), NOW(), NOW())`,
        [randomUUID(), partId, JSON.stringify({ source: 'MPN_DEDUP_REPAIR', actor: ACTOR })],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function writeReport(report) {
  if (!REPORT_PATH) return;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Report written to ${REPORT_PATH}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // pg clients serialize queries. Keep these reads explicit so the dry run
    // does not queue several large result sets behind one another.
    const brandMap = await loadBrandMap(client);
    const redirects = await loadRedirects(client);
    const partNumbersByTarget = await loadTargetPartNumbers(client);
    const uploadRows = await loadUploadOfferMappings(client);
    const targetOffers = await loadTargetOffers(client);

    for (const redirect of redirects) {
      redirect.blockers = blockersFor(
        {
          brand: redirect.sourceBrand,
          partSource: redirect.sourcePartSource,
          partType: redirect.sourcePartType,
          position: redirect.sourcePosition,
        },
        {
          brand: redirect.targetBrand,
          partSource: redirect.targetPartSource,
          partType: redirect.targetPartType,
          position: redirect.targetPosition,
        },
        brandMap,
      );
    }

    const plans = buildOfferPlans(redirects, uploadRows, targetOffers);
    for (const plan of plans) {
      plan.numberPlan = choosePartNumbers(plan.redirect, partNumbersByTarget, brandMap);
    }

    const unsafe = plans.filter((plan) => plan.redirect.blockers.length);
    const ready = unsafe.filter((plan) => plan.ambiguousOffers.length === 0);
    const blocked = unsafe.filter((plan) => plan.ambiguousOffers.length > 0);
    const summary = {
      mode: APPLY ? 'APPLY' : 'DRY_RUN',
      scannedRedirects: redirects.length,
      safeRedirectsKept: redirects.length - unsafe.length,
      unsafeRedirects: unsafe.length,
      readyForRepair: ready.length,
      blockedAmbiguous: blocked.length,
      offersRelinked: ready.reduce((sum, plan) => sum + plan.offerMoves.length, 0),
      partNumbersRelinked: ready.reduce((sum, plan) => sum + plan.numberPlan.ids.length, 0),
      missingPartNumberEvidence: ready.filter((plan) => plan.numberPlan.reason).length,
    };
    console.log(JSON.stringify(summary, null, 2));

    const report = {
      generatedAt: new Date().toISOString(),
      actor: ACTOR,
      summary,
      blockedSample: blocked.slice(0, 100).map((plan) => ({
        redirectId: plan.redirect.redirectId,
        fromPartId: plan.redirect.fromPartId,
        toPartId: plan.redirect.toPartId,
        sourceBrand: plan.redirect.sourceBrand,
        targetBrand: plan.redirect.targetBrand,
        blockers: plan.redirect.blockers,
        ambiguousOffers: plan.ambiguousOffers,
      })),
      repairSample: ready.slice(0, 100).map((plan) => ({
        redirectId: plan.redirect.redirectId,
        fromPartId: plan.redirect.fromPartId,
        toPartId: plan.redirect.toPartId,
        sourceBrand: plan.redirect.sourceBrand,
        targetBrand: plan.redirect.targetBrand,
        blockers: plan.redirect.blockers,
        offers: plan.offerMoves.length,
        partNumbers: plan.numberPlan.ids.length,
        numberPlanReason: plan.numberPlan.reason || null,
      })),
    };
    await writeReport(report);

    if (!APPLY) {
      console.log('Dry run only. Set APPLY=1 after reviewing the report to apply safe repairs.');
      return;
    }

    let repaired = 0;
    let failed = 0;
    for (const plan of ready) {
      try {
        await applyPlan(client, plan, plan.numberPlan);
        repaired++;
      } catch (error) {
        failed++;
        console.error(
          `Repair failed for ${plan.redirect.fromPartId} -> ${plan.redirect.toPartId}: ${error.message}`,
        );
      }
      if ((repaired + failed) % 100 === 0) {
        console.log(`Progress: processed=${repaired + failed}/${ready.length} repaired=${repaired} failed=${failed}`);
      }
    }
    console.log(JSON.stringify({ repaired, failed, blocked: blocked.length }, null, 2));
    if (failed) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
