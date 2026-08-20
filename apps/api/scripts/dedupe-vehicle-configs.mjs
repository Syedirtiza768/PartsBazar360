#!/usr/bin/env node
/**
 * QA-03: collapse duplicate VehicleConfiguration rows.
 *
 * Three creation sites did findFirst-then-create with no unique constraint;
 * under parallel MVL workers that raced, producing buyer-indistinguishable
 * duplicate configurations whose fitments then split across the twins
 * (live: one Corolla generation returned 52 vs 162 vs 165 parts depending
 * on which duplicate row the vehicle picker resolved).
 *
 * Two rows are duplicates when they share a generation and their display
 * fields (trim, engine, transmission, drivetrain, fuel) match after
 * lower(btrim()) with NULL treated as '' — exactly the semantics of the
 * "VehicleConfiguration_display_identity_key" migration, which therefore
 * cannot be applied until this script has run. `market` and `epid` are
 * provenance and are NOT part of the identity.
 *
 * Dry-run by default:
 *
 *   node scripts/dedupe-vehicle-configs.mjs
 *   APPLY=1 node scripts/dedupe-vehicle-configs.mjs
 *   DEDUPE_REPORT=/path/report.json node scripts/dedupe-vehicle-configs.mjs
 *
 * Per duplicate group the keeper is the config with the most fitments
 * (tie: most user vehicles, then lowest id). For every loser the script,
 * in one transaction:
 *   - carries epid / productionStart / productionEnd over to the keeper
 *     when the keeper lacks them (a loser's distinct epid is reported as
 *     dropped — it is @unique and cannot be kept on both),
 *   - re-points UserVehicle rows,
 *   - re-points Fitment rows, or — when the keeper already has a fitment
 *     for the same canonicalPartId (Fitment is @@unique([canonicalPartId,
 *     vehicleConfigId])) — moves the loser fitment's FitmentEvidence rows
 *     onto the keeper's fitment and deletes the loser fitment,
 *   - recomputes merged fitments' evidenceLevel/confidence from evidence,
 *   - deletes the loser configuration,
 *   - writes an AuditEvent and queues SearchOutbox UPSERTs for every
 *     affected canonical part so search fitment data refreshes.
 */
import { randomUUID } from 'node:crypto';
import { Client as PgClient } from 'pg';

const APPLY = process.env.APPLY === '1';
const LIMIT = Math.max(0, Number(process.env.DEDUPE_LIMIT || 0));
const REPORT_PATH = process.env.DEDUPE_REPORT || '';
const ACTOR = process.env.DEDUPE_ACTOR || 'system:vehicle-config-dedupe-qa03';

const DISPLAY_FIELDS = ['trim', 'engine', 'transmission', 'drivetrain', 'fuel'];
const LEVEL_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];

function strongerLevel(a, b) {
  const ia = LEVEL_ORDER.indexOf(a);
  const ib = LEVEL_ORDER.indexOf(b);
  if (ia === -1) return b;
  if (ib === -1) return a;
  return ia <= ib ? a : b;
}

async function loadGroups(client) {
  // Grouping expression must match the unique index exactly.
  const { rows } = await client.query(`
    SELECT
      "generationId",
      COALESCE(lower(btrim("trim")), '')         AS "trimKey",
      COALESCE(lower(btrim("engine")), '')       AS "engineKey",
      COALESCE(lower(btrim("transmission")), '') AS "transmissionKey",
      COALESCE(lower(btrim("drivetrain")), '')   AS "drivetrainKey",
      COALESCE(lower(btrim("fuel")), '')         AS "fuelKey",
      COUNT(*)::int AS "groupSize",
      array_agg(id ORDER BY id) AS ids
    FROM "VehicleConfiguration"
    GROUP BY 1, 2, 3, 4, 5, 6
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, "generationId"
  `);
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

async function loadConfigs(client, ids) {
  const { rows } = await client.query(
    `
    SELECT
      c.id,
      c."generationId",
      c.trim, c.engine, c.transmission, c.drivetrain, c.fuel,
      c.market, c.epid, c."productionStart", c."productionEnd",
      COALESCE(f.n, 0)::int AS "fitmentCount",
      COALESCE(uv.n, 0)::int AS "userVehicleCount"
    FROM "VehicleConfiguration" c
    LEFT JOIN (
      SELECT "vehicleConfigId" AS id, COUNT(*) AS n
      FROM "Fitment" WHERE "vehicleConfigId" = ANY($1::text[])
      GROUP BY 1
    ) f ON f.id = c.id
    LEFT JOIN (
      SELECT "vehicleConfigId" AS id, COUNT(*) AS n
      FROM "UserVehicle" WHERE "vehicleConfigId" = ANY($1::text[])
      GROUP BY 1
    ) uv ON uv.id = c.id
    WHERE c.id = ANY($1::text[])
    `,
    [ids],
  );
  return rows;
}

function chooseKeeper(configs) {
  return [...configs].sort((a, b) => {
    if (b.fitmentCount !== a.fitmentCount) return b.fitmentCount - a.fitmentCount;
    if (b.userVehicleCount !== a.userVehicleCount)
      return b.userVehicleCount - a.userVehicleCount;
    return a.id < b.id ? -1 : 1;
  })[0];
}

async function applyGroup(client, group, configs, keeper) {
  const losers = configs.filter((c) => c.id !== keeper.id);
  const stats = {
    userVehiclesMoved: 0,
    fitmentsRepointed: 0,
    fitmentsMerged: 0,
    evidenceMoved: 0,
    droppedEpids: [],
    affectedParts: new Set(),
  };

  await client.query('BEGIN');
  try {
    // Field carry-over: keep the keeper's values, fill gaps from losers.
    for (const loser of losers) {
      if (!keeper.epid && loser.epid) {
        // epid is @unique: clear it on the loser before setting it on the
        // keeper (unique checks are per-statement, not deferred).
        await client.query(
          `UPDATE "VehicleConfiguration" SET epid = NULL WHERE id = $1`,
          [loser.id],
        );
        await client.query(
          `UPDATE "VehicleConfiguration" SET epid = $1 WHERE id = $2`,
          [loser.epid, keeper.id],
        );
        keeper.epid = loser.epid;
      } else if (keeper.epid && loser.epid && loser.epid !== keeper.epid) {
        stats.droppedEpids.push({ loserId: loser.id, epid: loser.epid });
      }
      if (!keeper.productionStart && loser.productionStart) {
        await client.query(
          `UPDATE "VehicleConfiguration" SET "productionStart" = $1 WHERE id = $2`,
          [loser.productionStart, keeper.id],
        );
        keeper.productionStart = loser.productionStart;
      }
      if (!keeper.productionEnd && loser.productionEnd) {
        await client.query(
          `UPDATE "VehicleConfiguration" SET "productionEnd" = $1 WHERE id = $2`,
          [loser.productionEnd, keeper.id],
        );
        keeper.productionEnd = loser.productionEnd;
      }
    }

    // User vehicles simply re-point.
    for (const loser of losers) {
      const res = await client.query(
        `UPDATE "UserVehicle"
         SET "vehicleConfigId" = $1, "updatedAt" = NOW()
         WHERE "vehicleConfigId" = $2`,
        [keeper.id, loser.id],
      );
      stats.userVehiclesMoved += res.rowCount;
    }

    // Fitments: re-point when the keeper has no row for that part, else
    // merge evidence onto the keeper's fitment and drop the duplicate.
    const keeperFitments = new Map(); // canonicalPartId -> fitment row
    {
      const { rows } = await client.query(
        `SELECT id, "canonicalPartId", "evidenceLevel", confidence, "verificationStatus"
         FROM "Fitment" WHERE "vehicleConfigId" = $1`,
        [keeper.id],
      );
      for (const row of rows) keeperFitments.set(row.canonicalPartId, row);
    }

    for (const loser of losers) {
      const { rows: loserFitments } = await client.query(
        `SELECT id, "canonicalPartId", "evidenceLevel", confidence, "verificationStatus"
         FROM "Fitment" WHERE "vehicleConfigId" = $1`,
        [loser.id],
      );

      for (const fitment of loserFitments) {
        stats.affectedParts.add(fitment.canonicalPartId);
        const keeperFitment = keeperFitments.get(fitment.canonicalPartId);
        if (!keeperFitment) {
          await client.query(
            `UPDATE "Fitment"
             SET "vehicleConfigId" = $1, "updatedAt" = NOW()
             WHERE id = $2`,
            [keeper.id, fitment.id],
          );
          keeperFitments.set(fitment.canonicalPartId, {
            ...fitment,
            id: fitment.id,
          });
          stats.fitmentsRepointed++;
          continue;
        }

        const ev = await client.query(
          `UPDATE "FitmentEvidence" SET "fitmentId" = $1 WHERE "fitmentId" = $2`,
          [keeperFitment.id, fitment.id],
        );
        stats.evidenceMoved += ev.rowCount;

        const mergedLevel = strongerLevel(
          keeperFitment.evidenceLevel,
          fitment.evidenceLevel,
        );
        const mergedConfidence = Math.max(
          keeperFitment.confidence ?? 0,
          fitment.confidence ?? 0,
        );
        const mergedStatus =
          keeperFitment.verificationStatus === 'VERIFIED' ||
          fitment.verificationStatus === 'VERIFIED'
            ? 'VERIFIED'
            : keeperFitment.verificationStatus;
        await client.query(
          `UPDATE "Fitment"
           SET "evidenceLevel" = $1, confidence = $2, "verificationStatus" = $3,
               "updatedAt" = NOW()
           WHERE id = $4`,
          [mergedLevel, mergedConfidence, mergedStatus, keeperFitment.id],
        );
        keeperFitment.evidenceLevel = mergedLevel;
        keeperFitment.confidence = mergedConfidence;
        keeperFitment.verificationStatus = mergedStatus;

        // FitmentEvidence.fitmentId cascades, so evidence must already be
        // moved (above) before this delete.
        await client.query(`DELETE FROM "Fitment" WHERE id = $1`, [fitment.id]);
        stats.fitmentsMerged++;
      }

      await client.query(
        `DELETE FROM "VehicleConfiguration" WHERE id = $1`,
        [loser.id],
      );
    }

    await client.query(
      `INSERT INTO "AuditEvent"
        (id, action, "entityType", "entityId", "actorType", "actorId", source,
         reason, metadata)
       VALUES ($1, 'VEHICLE_CONFIG_DEDUPE', 'VehicleConfiguration', $2,
               'SYSTEM', $3, 'QA_03', $4, $5::jsonb)`,
      [
        randomUUID(),
        keeper.id,
        ACTOR,
        'Collapsed duplicate vehicle configurations (QA-03)',
        JSON.stringify({
          generationId: group.generationId,
          identity: DISPLAY_FIELDS.map((f) => group[`${f}Key`]),
          keeperId: keeper.id,
          loserIds: losers.map((l) => l.id),
          userVehiclesMoved: stats.userVehiclesMoved,
          fitmentsRepointed: stats.fitmentsRepointed,
          fitmentsMerged: stats.fitmentsMerged,
          evidenceMoved: stats.evidenceMoved,
          droppedEpids: stats.droppedEpids,
        }),
      ],
    );

    for (const partId of stats.affectedParts) {
      await client.query(
        `INSERT INTO "SearchOutbox"
          (id, "entityType", "entityId", operation, payload, status,
           "availableAt", "createdAt", "updatedAt")
         VALUES ($1, 'CanonicalPart', $2, 'UPSERT', $3::jsonb, 'PENDING',
                 NOW(), NOW(), NOW())`,
        [
          randomUUID(),
          partId,
          JSON.stringify({ source: 'VEHICLE_CONFIG_DEDUPE', actor: ACTOR }),
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return { ...stats, affectedParts: [...stats.affectedParts] };
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
    const groups = await loadGroups(client);
    const plans = [];
    for (const group of groups) {
      const configs = await loadConfigs(client, group.ids);
      const keeper = chooseKeeper(configs);
      const losers = configs.filter((c) => c.id !== keeper.id);
      plans.push({
        group,
        keeper: {
          id: keeper.id,
          market: keeper.market,
          epid: keeper.epid,
          fitmentCount: keeper.fitmentCount,
          userVehicleCount: keeper.userVehicleCount,
        },
        losers: losers.map((l) => ({
          id: l.id,
          market: l.market,
          epid: l.epid,
          fitmentCount: l.fitmentCount,
          userVehicleCount: l.userVehicleCount,
        })),
      });
    }

    const summary = {
      mode: APPLY ? 'APPLY' : 'DRY_RUN',
      duplicateGroups: plans.length,
      duplicateRows: plans.reduce((sum, p) => sum + p.losers.length, 0),
      loserFitments: plans.reduce(
        (sum, p) => sum + p.losers.reduce((s, l) => s + l.fitmentCount, 0),
        0,
      ),
      loserUserVehicles: plans.reduce(
        (sum, p) => sum + p.losers.reduce((s, l) => s + l.userVehicleCount, 0),
        0,
      ),
    };
    console.log(JSON.stringify(summary, null, 2));

    const report = {
      generatedAt: new Date().toISOString(),
      actor: ACTOR,
      summary,
      groups: plans,
    };

    if (!APPLY) {
      await writeReport(report);
      console.log(
        'Dry run only. Review the report, then set APPLY=1. The ' +
          'VehicleConfiguration_display_identity_key migration can only be ' +
          'applied after this script has collapsed every group.',
      );
      return;
    }

    const applied = [];
    let failed = 0;
    for (const plan of plans) {
      try {
        const configs = await loadConfigs(client, plan.group.ids);
        const keeper = chooseKeeper(configs);
        const result = await applyGroup(client, plan.group, configs, keeper);
        applied.push({
          keeperId: keeper.id,
          loserIds: plan.losers.map((l) => l.id),
          ...result,
          affectedParts: result.affectedParts.length,
        });
      } catch (error) {
        failed++;
        console.error(
          `Dedupe failed for group ${plan.group.generationId} ` +
            `(${plan.group.ids.join(', ')}): ${error.message}`,
        );
      }
      if ((applied.length + failed) % 50 === 0) {
        console.log(
          `Progress: processed=${applied.length + failed}/${plans.length} ` +
            `failed=${failed}`,
        );
      }
    }

    report.applied = applied;
    await writeReport(report);
    console.log(
      JSON.stringify(
        { mergedGroups: applied.length, failed },
        null,
        2,
      ),
    );
    if (failed) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
