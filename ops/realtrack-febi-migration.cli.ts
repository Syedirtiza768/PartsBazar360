import { NestFactory } from '@nestjs/core';
import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { ListingsService } from '../listings/listings.service.js';

type MigrationDto = Record<string, unknown>;

type MigrationRecord = {
  sourceOfferId: string;
  sourcePartId: string;
  sourceSellerId: string;
  sourceBrand: string | null;
  sourceSku: string | null;
  targetSku: string;
  sourceCost: number;
  sourceCurrency: string;
  convertedCostUsd: number | null;
  conversionRateToUsd: number | null;
  sellingPriceUsd: number | null;
  quantity: number;
  imageCount: number;
  fitmentCount: number;
  skipReason: string | null;
  skipDetail: string | null;
  dto: MigrationDto | null;
};

type MigrationBundle = {
  schemaVersion: string;
  generatedAt: string;
  filter: {
    brand?: string | null;
    status?: string | null;
    includeOutOfStock?: boolean;
    maxItems?: number;
  };
  targetCurrency: string;
  counts: { selected: number; eligible: number; skipped: number };
  records: MigrationRecord[];
};

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function expectedPriceUsd(cost: number): number | null {
  if (!Number.isFinite(cost) || cost < 5) return null;
  if (cost <= 15) return 38;
  if (cost <= 21) return 45.99;
  if (cost <= 25) return 49.99;
  return Math.round((cost * 2 + Number.EPSILON) * 100) / 100;
}

function validateBundle(bundle: MigrationBundle): MigrationRecord[] {
  if (bundle.schemaVersion !== 'parts-bazar-realtrack-migration/v1') {
    throw new Error(`Unsupported migration schema: ${bundle.schemaVersion}`);
  }
  if (bundle.targetCurrency !== 'USD') {
    throw new Error('Migration target currency must be USD');
  }
  if (String(bundle.filter?.brand || '').trim().toUpperCase() !== 'FEBI') {
    throw new Error('This migration runner only accepts an exact FEBI filter');
  }
  if (bundle.filter?.status && bundle.filter.status !== 'ACTIVE') {
    throw new Error('This migration runner only accepts ACTIVE offers');
  }
  if (!Array.isArray(bundle.records) || bundle.records.length > 5000) {
    throw new Error('Migration bundle must contain between 1 and 5000 records');
  }

  const seenSkus = new Set<string>();
  const eligible: MigrationRecord[] = [];
  const validationErrors: string[] = [];

  for (const record of bundle.records) {
    if (!record.targetSku || seenSkus.has(record.targetSku)) {
      validationErrors.push(`duplicate or missing target SKU: ${record.targetSku}`);
      continue;
    }
    seenSkus.add(record.targetSku);

    if (record.skipReason) {
      if (record.dto !== null) {
        validationErrors.push(`${record.targetSku}: skipped record has a DTO`);
      }
      continue;
    }

    const dto = record.dto;
    const convertedCostUsd = numberValue(record.convertedCostUsd);
    const expectedPrice =
      convertedCostUsd === null ? null : expectedPriceUsd(convertedCostUsd);
    const actualPrice = numberValue(dto?.startPrice);
    const quantity = numberValue(dto?.quantity);
    const imageUrls = Array.isArray(dto?.imageUrls) ? dto.imageUrls : [];
    const fitmentRows = Array.isArray(dto?.fitmentRows) ? dto.fitmentRows : [];

    if (!dto) validationErrors.push(`${record.targetSku}: missing DTO`);
    if (convertedCostUsd === null || convertedCostUsd < 5) {
      validationErrors.push(`${record.targetSku}: invalid or ineligible USD cost`);
    }
    if (expectedPrice === null || actualPrice !== expectedPrice) {
      validationErrors.push(
        `${record.targetSku}: price ${String(dto?.startPrice)} does not match the USD pricing rule`,
      );
    }
    if (quantity === null || quantity <= 0 || quantity !== record.quantity) {
      validationErrors.push(`${record.targetSku}: invalid available quantity`);
    }
    if (dto?.customLabelSku !== record.targetSku) {
      validationErrors.push(`${record.targetSku}: DTO SKU mismatch`);
    }
    if (dto?.status !== 'ready') {
      validationErrors.push(`${record.targetSku}: DTO status must be ready`);
    }
    if (imageUrls.length !== record.imageCount) {
      validationErrors.push(`${record.targetSku}: image count mismatch`);
    }
    if (fitmentRows.length !== record.fitmentCount) {
      validationErrors.push(`${record.targetSku}: fitment count mismatch`);
    }
    if (
      imageUrls.some(
        (url) => typeof url !== 'string' || !/^https?:\/\//i.test(url),
      )
    ) {
      validationErrors.push(`${record.targetSku}: image URL is not HTTP(S)`);
    }
    eligible.push(record);
  }

  if (validationErrors.length) {
    throw new Error(
      `Migration validation failed for ${validationErrors.length} record(s):\n${validationErrors
        .slice(0, 20)
        .join('\n')}`,
    );
  }
  return eligible;
}

async function ensureAuditTable(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS realtrack_bridge_migration_items (
      migration_id text NOT NULL,
      source_offer_id text NOT NULL,
      source_part_id text,
      target_sku text NOT NULL,
      target_listing_id uuid,
      status varchar(20) NOT NULL,
      source_currency varchar(8),
      converted_cost_usd numeric(12,6),
      selling_price_usd numeric(12,2),
      image_count integer NOT NULL DEFAULT 0,
      fitment_count integer NOT NULL DEFAULT 0,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (migration_id, source_offer_id),
      UNIQUE (migration_id, target_sku)
    )
  `);
}

async function existingListings(
  dataSource: DataSource,
  skus: string[],
): Promise<Set<string>> {
  if (!skus.length) return new Set();
  const rows = (await dataSource.query(
    `SELECT "customLabelSku" AS sku FROM listing_records
     WHERE "customLabelSku" = ANY($1::text[]) AND "deletedAt" IS NULL`,
    [skus],
  )) as Array<{ sku: string }>;
  return new Set(rows.map((row) => row.sku));
}

async function completedItems(
  dataSource: DataSource,
  migrationId: string,
): Promise<Set<string>> {
  try {
    const rows = (await dataSource.query(
      `SELECT source_offer_id AS "sourceOfferId"
       FROM realtrack_bridge_migration_items
       WHERE migration_id = $1 AND status = 'completed'`,
      [migrationId],
    )) as Array<{ sourceOfferId: string }>;
    return new Set(rows.map((row) => row.sourceOfferId));
  } catch {
    return new Set();
  }
}

async function upsertAudit(
  dataSource: DataSource,
  migrationId: string,
  record: MigrationRecord,
  status: string,
  listingId: string | null,
  error: string | null,
): Promise<void> {
  await dataSource.query(
    `INSERT INTO realtrack_bridge_migration_items
      (migration_id, source_offer_id, source_part_id, target_sku,
       target_listing_id, status, source_currency, converted_cost_usd,
       selling_price_usd, image_count, fitment_count, error, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     ON CONFLICT (migration_id, source_offer_id) DO UPDATE SET
       source_part_id = EXCLUDED.source_part_id,
       target_sku = EXCLUDED.target_sku,
       target_listing_id = EXCLUDED.target_listing_id,
       status = EXCLUDED.status,
       source_currency = EXCLUDED.source_currency,
       converted_cost_usd = EXCLUDED.converted_cost_usd,
       selling_price_usd = EXCLUDED.selling_price_usd,
       image_count = EXCLUDED.image_count,
       fitment_count = EXCLUDED.fitment_count,
       error = EXCLUDED.error,
       updated_at = now()`,
    [
      migrationId,
      record.sourceOfferId,
      record.sourcePartId,
      record.targetSku,
      listingId,
      status,
      record.sourceCurrency,
      record.convertedCostUsd,
      record.sellingPriceUsd,
      record.imageCount,
      record.fitmentCount,
      error,
    ],
  );
}

async function main() {
  const input = argument('input');
  if (!input) throw new Error('--input is required');
  const migrationId =
    argument('migration-id', 'febi-realtrack-v1') || 'febi-realtrack-v1';
  const bundle = JSON.parse(
    await readFile(input, 'utf8'),
  ) as MigrationBundle;
  const eligible = validateBundle(bundle);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const dataSource = app.get(DataSource);
    const listings = app.get(ListingsService);
    const skus = eligible.map((record) => record.targetSku);
    const existing = await existingListings(dataSource, skus);
    const dryRun = !hasFlag('commit');

    if (dryRun) {
      console.log(
        JSON.stringify({
          dryRun: true,
          migrationId,
          bundleCounts: bundle.counts,
          eligible: eligible.length,
          skippedByEligibility: bundle.records.length - eligible.length,
          wouldCreate: eligible.filter((record) => !existing.has(record.targetSku)).length,
          wouldUpdate: eligible.filter((record) => existing.has(record.targetSku)).length,
          imageRows: eligible.reduce((sum, record) => sum + record.imageCount, 0),
          fitmentRows: eligible.reduce((sum, record) => sum + record.fitmentCount, 0),
        }),
      );
      return;
    }

    await ensureAuditTable(dataSource);
    const alreadyCompleted = await completedItems(dataSource, migrationId);
    let completed = 0;
    let failed = 0;
    let skippedCompleted = 0;

    for (const [index, record] of eligible.entries()) {
      if (alreadyCompleted.has(record.sourceOfferId)) {
        skippedCompleted += 1;
        continue;
      }

      await upsertAudit(dataSource, migrationId, record, 'running', null, null);
      try {
        const result = await listings.create(record.dto as never);
        const listingId =
          result && typeof result === 'object' && 'listing' in result
            ? String((result as { listing?: { id?: string } }).listing?.id || '')
            : '';
        await upsertAudit(
          dataSource,
          migrationId,
          record,
          'completed',
          listingId || null,
          null,
        );
        completed += 1;
      } catch (error: unknown) {
        failed += 1;
        await upsertAudit(
          dataSource,
          migrationId,
          record,
          'failed',
          null,
          error instanceof Error ? error.message.slice(0, 1000) : 'unknown error',
        );
      }

      if ((index + 1) % 25 === 0 || index === eligible.length - 1) {
        console.log(
          JSON.stringify({
            phase: 'committing',
            processed: index + 1,
            eligible: eligible.length,
            completed,
            failed,
            skippedCompleted,
          }),
        );
      }
    }

    console.log(
      JSON.stringify({
        dryRun: false,
        migrationId,
        eligible: eligible.length,
        completed,
        failed,
        skippedCompleted,
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
