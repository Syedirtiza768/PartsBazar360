#!/usr/bin/env node

import fs from 'node:fs/promises';
import { Client as PgClient } from 'pg';

const SOURCE = process.env.ENHANCE_SOURCE || 'gpt-5.6-luna:superior-imaged-seo-v1';
const reportPaths = String(process.env.REPORT_PATHS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function readRows(path) {
  const raw = await fs.readFile(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!reportPaths.length) throw new Error('REPORT_PATHS is required');

  const rows = (await Promise.all(reportPaths.map(readRows))).flat();
  const candidates = rows.filter((row) => String(row.status || '').startsWith('updated'));
  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let updated = 0;
  try {
    for (const row of candidates) {
      const luna = row.luna || {};
      const specifics = {
        ...(row.proposedItemSpecifics || {}),
        _seo: {
          source: SOURCE,
          decision: row.status === 'updated' ? 'APPROVE' : 'CONTENT_UPDATED_IMAGE_REVIEW',
          identityConfidence: text(luna.identityConfidence).toUpperCase() || 'UNKNOWN',
          imageAssessment: row.primaryImageUrl
            ? text(luna.imageAssessment).toUpperCase() || 'UNKNOWN'
            : 'NOT_AVAILABLE',
          imageConfidence: row.primaryImageUrl
            ? text(luna.imageConfidence).toUpperCase() || 'NONE'
            : 'NONE',
          imageHealth: row.imageHealth?.status || (row.primaryImageUrl ? 'unknown' : 'missing_image'),
        },
      };
      const result = await client.query(
        `UPDATE "CanonicalPart"
         SET "itemSpecifics" = $2::jsonb, "updatedAt" = now()
         WHERE id = $1 AND "enrichmentSource" = $3
         RETURNING id`,
        [row.id, JSON.stringify(specifics), SOURCE],
      );
      if (result.rowCount) updated += 1;
    }
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ reports: reportPaths, candidates: candidates.length, updated }));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
