/**
 * Reconcile operator-supplied eBay active-listings reports with the
 * store-scoped RealTrack mirror and PartsBazar offers.
 *
 * The CSV exports used by this job contain scientific-notation item numbers,
 * so their item IDs are not treated as authoritative. Matching is:
 *   1. RealTrack store scope
 *   2. report SKU (Custom label / SKU)
 *
 * The job is dry-run by default. CONFIRM=1 imports missing/reactivated
 * listings and deactivates stale ACTIVE offers. Deactivation is blocked
 * unless the report is non-empty, every row has a SKU, the complete
 * store-scoped RealTrack scan succeeds, and at least one source listing
 * matches.
 *
 * Example:
 *   SCOPE=SAL,BLK,STX \
 *   SALVAGE_FILE=/data/salvage.csv \
 *   BLACKLINE_FILE=/data/blackline.csv \
 *   SUPERIOR_FILE=/data/superior.csv \
 *   node dist/src/reconcile-realtrack-reports.cli.js
 *
 *   CONFIRM=1 ... node dist/src/reconcile-realtrack-reports.cli.js
 */
import 'dotenv/config';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { OpenSearchService } from './modules/search/opensearch.service';
import { RealTrackService } from './modules/integration/realtrack.service';
import { IngestionProcessor } from './modules/ingestion/ingestion.processor';
import {
  MARKETPLACE_SELLERS,
  REALTRACK_RECONCILIATION_SCOPES,
} from './modules/seed/marketplace-sellers.config';
import { readActiveItemNumbers } from './modules/catalog-import/active-listings-file.util';
import { BUYER_MARKETPLACE_ID } from './modules/ingestion/listing-eligibility.util';

type Scope = keyof typeof REALTRACK_RECONCILIATION_SCOPES;
type ReconciliationScope = (typeof REALTRACK_RECONCILIATION_SCOPES)[Scope];

function normalizeSku(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function asScope(value: string): value is Scope {
  return value in REALTRACK_RECONCILIATION_SCOPES;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function readCsvReport(filePath: string) {
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let headers: string[] | null = null;
  let itemIndex = -1;
  let skuIndex = -1;
  let rowCount = 0;
  let missingSkuRows = 0;
  const skus = new Set<string>();

  for await (const line of reader) {
    const values = parseCsvLine(line);
    if (!headers) {
      headers = values.map((header) =>
        header.replace(/^\\uFEFF/, '').trim(),
      );
      itemIndex = headers.indexOf('Item number');
      skuIndex = headers.indexOf('Custom label (SKU)');
      if (itemIndex < 0) {
        throw new Error('"Item number" column not found in ' + filePath);
      }
      if (skuIndex < 0) {
        throw new Error('"Custom label (SKU)" column not found in ' + filePath);
      }
      continue;
    }
    const itemNumber = String(values[itemIndex] || '').trim();
    if (!itemNumber) continue;
    rowCount++;
    const sku = normalizeSku(values[skuIndex]);
    if (sku) skus.add(sku);
    else missingSkuRows++;
  }

  return { rowCount, skus, missingSkuRows };
}

async function readReport(filePath: string) {
  if (filePath.toLowerCase().endsWith('.csv')) {
    return readCsvReport(filePath);
  }
  const fileRows = await readActiveItemNumbers(filePath);
  const skus = new Set(
    [...fileRows.values()]
      .map(normalizeSku)
      .filter((sku) => sku.length > 0),
  );
  return {
    rowCount: fileRows.size,
    skus,
    missingSkuRows: [...fileRows.values()].filter(
      (sku) => normalizeSku(sku).length === 0,
    ).length,
  };
}

async function scanRealTrack(
  realTrack: RealTrackService,
  scope: ReconciliationScope,
  reportSkus: Set<string>,
) {
  const listings = new Map<string, any>();
  const pageLimit = Math.max(
    50,
    Math.min(200, Number(process.env.RECONCILE_PAGE_LIMIT || 200)),
  );
  const pageDelayMs = Math.max(
    0,
    Number(process.env.RECONCILE_PAGE_DELAY_MS || 1500),
  );
  const activeStatus = process.env.REALTRACK_ACTIVE_STATUS || 'active';
  let page = 1;
  let scanned = 0;
  let total = 0;
  let complete = false;

  while (true) {
    const result = await realTrack.fetchListings({
      page,
      limit: pageLimit,
      storeId: scope.storeId,
      marketplaceId: BUYER_MARKETPLACE_ID,
      status: activeStatus,
    });
    total = result.total || total;
    if (result.items.length === 0) {
      complete = true;
      break;
    }

    scanned += result.items.length;
    for (const listing of result.items) {
      if (listing.storeId && listing.storeId !== scope.storeId) continue;
      const sku = normalizeSku(listing.sku);
      if (!sku || !reportSkus.has(sku) || !listing.id) continue;
      listings.set(String(listing.id), listing);
    }

    if (page % 25 === 0) {
      console.log(`${scope.key}: scanned=${scanned}/${total || '?'} pages=${page} sourceMatches=${listings.size}`);
    }

    const reachedTotal = total > 0 && scanned >= total;
    const shortPage = result.items.length < (result.limit || pageLimit);
    if (reachedTotal || shortPage) {
      complete = true;
      break;
    }
    page++;
    if (pageDelayMs > 0) await sleep(pageDelayMs);
  }

  return {
    listings: [...listings.values()],
    scanned,
    total,
    pages: page,
    complete,
    activeStatus,
  };
}

async function reindexParts(
  prisma: PrismaService,
  search: OpenSearchService,
  partIds: string[],
) {
  const batchSize = Math.max(10, Number(process.env.REINDEX_BATCH || 100));
  let reindexed = 0;
  for (let offset = 0; offset < partIds.length; offset += batchSize) {
    const ids = partIds.slice(offset, offset + batchSize);
    const parts = await prisma.canonicalPart.findMany({
      where: { id: { in: ids } },
      include: {
        offers: { include: { seller: true } },
        partNumbers: true,
      },
    });
    for (const part of parts) {
      try {
        await search.indexPart(part);
        reindexed++;
      } catch (error) {
        console.warn(
          `reindex failed for ${part.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    console.log(
      `  ... reindexed ${Math.min(offset + batchSize, partIds.length)}/${partIds.length}`,
    );
  }
  return reindexed;
}

async function main() {
  const apply = process.env.CONFIRM === '1';
  const requestedScopes = (process.env.SCOPE || 'SAL,BLK,STX')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const scopes = requestedScopes.filter(asScope);
  for (const value of requestedScopes.filter((value) => !asScope(value))) {
    console.warn(`Unknown scope "${value}", skipping.`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const search = app.get(OpenSearchService);
  const realTrack = app.get(RealTrackService);
  const ingestion = app.get(IngestionProcessor);
  const summary: Record<string, any> = {};

  try {
    for (const scopeKey of scopes) {
      const scope = REALTRACK_RECONCILIATION_SCOPES[scopeKey];
      const sellerConfig = MARKETPLACE_SELLERS[scope.sellerKey];
      const filePath = process.env[scope.fileEnv];
      if (!filePath) {
        console.warn(`${scope.fileEnv} is not set, skipping ${scopeKey}.`);
        continue;
      }

      console.log(`\n=== ${scopeKey} — ${sellerConfig.name} — ${filePath}`);
      const report = await readReport(filePath);
      const reportSkus = report.skus;
      const missingSkuRows = report.missingSkuRows;
      console.log(
        `Report rows=${report.rowCount} reportSkus=${reportSkus.size} missingSkuRows=${missingSkuRows}`,
      );

      const seller =
        (await prisma.seller.findFirst({
          where: { id: scope.sellerId },
          select: { id: true, name: true },
        })) ||
        (await prisma.seller.findFirst({
          where: { name: sellerConfig.name },
          select: { id: true, name: true },
        }));
      if (!seller) {
        console.warn(`No seller found for ${sellerConfig.name}, skipping.`);
        summary[scopeKey] = { error: 'seller_not_found' };
        continue;
      }

      let sourceScan: Awaited<ReturnType<typeof scanRealTrack>> | null = null;
      let sourceError: string | null = null;
      try {
        sourceScan = await scanRealTrack(realTrack, scope, reportSkus);
      } catch (error) {
        sourceError = error instanceof Error ? error.message : String(error);
        console.error(`${scopeKey}: RealTrack scan failed: ${sourceError}`);
      }

      const sourceListings = sourceScan?.listings || [];
      const sourceMatchedExternalIds = new Set(
        sourceListings.map((listing) => String(listing.id)),
      );
      const sourceMatchedSkus = new Set(
        sourceListings.map((listing) => normalizeSku(listing.sku)),
      );

      const sellerOffers = await prisma.sellerOffer.findMany({
        where: { sellerId: seller.id },
        select: {
          status: true,
          externalOfferId: true,
          sourceKey: true,
          sellerSku: true,
          canonicalPart: { select: { ebayItemId: true } },
        },
      });
      const activeExternalIds = new Set<string>();
      const activeSourceKeys = new Set<string>();
      const activeEbayItemIds = new Set<string>();
      for (const offer of sellerOffers) {
        if (offer.status !== 'ACTIVE') continue;
        if (offer.externalOfferId) {
          activeExternalIds.add(String(offer.externalOfferId));
        }
        if (offer.sourceKey) activeSourceKeys.add(offer.sourceKey);
        if (offer.canonicalPart?.ebayItemId) {
          activeEbayItemIds.add(offer.canonicalPart.ebayItemId);
        }
      }

      const importCandidates = sourceListings.filter((listing) => {
        const listingId = String(listing.id);
        const sourceKey = `rt:${scope.storeId}:${listingId}`;
        return (
          !activeExternalIds.has(listingId) &&
          !activeSourceKeys.has(sourceKey) &&
          !(
            listing.ebayItemId &&
            activeEbayItemIds.has(String(listing.ebayItemId))
          )
        );
      });

      let imported = 0;
      let importSkipped = 0;
      const importErrors: Array<{ listingId?: string; message: string }> = [];
      if (apply && sourceScan?.complete) {
        for (const listing of importCandidates) {
          try {
            const outcome = await ingestion.processReconciliationListing(
              listing,
              scope.storeId,
              seller.id,
              scope.sourceTag,
            );
            if (outcome === 'imported') imported++;
            else importSkipped++;
          } catch (error) {
            importErrors.push({
              listingId: listing.id,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      const activeOffers = await prisma.sellerOffer.findMany({
        where: {
          sellerId: seller.id,
          sourceTag: scope.sourceTag,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          canonicalPartId: true,
          externalOfferId: true,
          sellerSku: true,
          canonicalPart: { select: { ebayItemId: true } },
        },
      });
      const deactivationAllowed =
        !sourceError &&
        !!sourceScan?.complete &&
        report.rowCount > 0 &&
        reportSkus.size > 0 &&
        missingSkuRows === 0 &&
        sourceListings.length > 0;
      const toDeactivate = activeOffers.filter((offer) => {
        const inReportBySku =
          !!normalizeSku(offer.sellerSku) &&
          reportSkus.has(normalizeSku(offer.sellerSku));
        const inScannedSource =
          !!offer.externalOfferId &&
          sourceMatchedExternalIds.has(String(offer.externalOfferId));
        return !inReportBySku && !inScannedSource;
      });

      let deactivated = 0;
      let reindexed = 0;
      if (apply && deactivationAllowed && toDeactivate.length > 0) {
        await prisma.sellerOffer.updateMany({
          where: { id: { in: toDeactivate.map((offer) => offer.id) } },
          data: { status: 'INACTIVE' },
        });
        deactivated = toDeactivate.length;
        reindexed = await reindexParts(
          prisma,
          search,
          [...new Set(toDeactivate.map((offer) => offer.canonicalPartId))],
        );
      }

      const guardReason = deactivationAllowed
        ? null
        : sourceError
          ? 'realtrack_scan_failed'
          : !sourceScan?.complete
            ? 'realtrack_scan_incomplete'
            : report.rowCount === 0
              ? 'empty_report'
              : reportSkus.size === 0
                ? 'no_report_skus'
                : missingSkuRows > 0
                  ? 'report_rows_missing_sku'
                  : 'no_source_matches';

      summary[scopeKey] = {
        seller: seller.name,
        reportRows: report.rowCount,
        reportSkus: reportSkus.size,
        missingSkuRows,
        matchingMode: 'store-scoped SKU fallback',
        realTrackStoreId: scope.storeId,
        realTrackStatus: sourceScan?.activeStatus || null,
        realTrackScanned: sourceScan?.scanned || 0,
        realTrackTotal: sourceScan?.total || 0,
        realTrackPages: sourceScan?.pages || 0,
        realTrackScanComplete: !!sourceScan?.complete,
        realTrackSourceMatches: sourceListings.length,
        sourceMatchedSkus: sourceMatchedSkus.size,
        existingActiveScopeOffers: activeOffers.length,
        importCandidates: importCandidates.length,
        imported: apply ? imported : 0,
        importSkipped: apply ? importSkipped : 0,
        importErrors,
        wouldDeactivate: toDeactivate.length,
        deactivated,
        reindexed,
        deactivationGuard: guardReason,
        applied: apply,
        imageCopies: 0,
        imageHandling: 'shared source URLs retained; no S3 image binaries copied',
      };

      console.log(
        `${scopeKey}: sourceMatches=${sourceListings.length} importCandidates=${importCandidates.length} ` +
          `wouldDeactivate=${toDeactivate.length} ${
            apply
              ? `imported=${imported} deactivated=${deactivated}`
              : 'DRY RUN'
          }`,
      );
      if (!deactivationAllowed) {
        console.log(`  deactivation guarded: ${guardReason}`);
      }
      if (importErrors.length) {
        console.log(
          `  import errors sample: ${JSON.stringify(importErrors.slice(0, 5))}`,
        );
      }
    }

    const reportPath = path.resolve(
      process.env.RECONCILE_REPORT_PATH ||
        '/tmp/reconcile-realtrack-reports.json',
    );
    await fs.writeFile(reportPath, JSON.stringify(summary, null, 2));
    console.log(`\nReport written to ${reportPath}`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
