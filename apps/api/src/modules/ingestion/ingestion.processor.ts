import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { RealTrackService } from '../integration/realtrack.service';
import { PrismaService } from '../../prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import {
  extractCategory,
  parseVehicleFromTitle,
  extractOeNumbers,
  ParsedVehicle,
} from './listing-parser.util';
import { normalizePartNumber } from '../catalog-import/part-normalization.util';
import {
  buildCompatibility,
  extractListingBrand,
  extractListingDescription,
  extractListingImages,
  extractListingOeNumbers,
  prioritizeEbayImages,
} from './listing-enrichment.util';
import {
  BUYER_MARKETPLACE_ID,
  isImportableListing,
  isUsMotorsMarketplace,
  MARKETPLACE_CURRENCY,
  stockQuantityForImport,
} from './listing-eligibility.util';

/**
 * Brands managed through their own dedicated supplier pipeline (spreadsheet upload).
 * RealTrack ingestion (Salvage/Blackline) must skip these to avoid duplicates.
 */
const REALTRACK_EXCLUDED_BRANDS = new Set(['FEBEST']);
import {
  extractEnglishTitle,
  looksLikeEnglishTitle,
} from './listing-title.util';
import { MvlFitmentService } from './mvl-fitment.service';
import { Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import {
  REALTRACK_MARKETPLACE_SELLERS,
  resolveRealTrackSyncTarget,
} from '../seed/marketplace-sellers.config';
import { tagFromStoreId } from '../catalog-import/source-tag.util';

@Processor('ingestion', {
  concurrency: 2,
})
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);
  private readonly redis: Redis;

  constructor(
    private readonly realTrackService: RealTrackService,
    private readonly prisma: PrismaService,
    private readonly searchService: OpenSearchService,
    private readonly pricing: PricingService,
    private readonly mvlFitment: MvlFitmentService,
  ) {
    super();
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: null,
    });
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    switch (job.name) {
      case 'sync-store': {
        const target = resolveRealTrackSyncTarget({
          storeId: job.data.storeId,
          storeSlug: job.data.storeSlug,
        });
        return this.syncStore(
          target.storeId!,
          job.data.page || 1,
          target.storeSlug || undefined,
        );
      }
      case 'sync-marketplace':
        return this.syncMarketplace(job.data.marketplaceId, job.data.page || 1);
      case 'sync-all-us':
      case 'sync-marketplace-realtrack':
        return this.syncMarketplaceRealTrackStores();
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        return;
    }
  }

  async syncStoreComplete(
    storeId: string,
    listingLimit?: number,
    storeSlug?: string,
    syncRunId?: string,
  ) {
    const target = resolveRealTrackSyncTarget({ storeId, storeSlug });
    const canonicalStoreId = target.storeId!;
    const redisKey = `sync:store:${canonicalStoreId}`;

    // Resume: check Redis for last completed page
    let page = 1;
    const savedPage = await this.redis.get(`${redisKey}:lastPage`);
    if (savedPage && Number(savedPage) > 1) {
      page = Number(savedPage) + 1;
      this.logger.log(
        `[${syncRunId}] Resuming ${target.name} from page ${page} (last completed: ${savedPage})`,
      );
    }

    let discovered = 0;
    let imported = 0;
    let skippedWrongStore = 0;
    let skippedInactiveOrZero = 0;
    let skippedNonEnglish = 0;
    let skippedWrongMarketplace = 0;
    let skippedExcludedBrand = 0;
    const errors: Array<{ listingId?: string; message: string }> = [];

    // Save initial state
    await this.redis.hset(redisKey, {
      store: target.name,
      storeId: canonicalStoreId,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    while (true) {
      const remaining = listingLimit ? listingLimit - discovered : 200;
      if (listingLimit && remaining <= 0) break;

      try {
        const result = await this.realTrackService.fetchListings({
          page,
          limit: Math.min(200, remaining),
          storeId: canonicalStoreId,
          marketplaceId: BUYER_MARKETPLACE_ID,
        });
        if (result.items.length === 0) break;
        discovered += result.items.length;

        for (const summary of result.items) {
          try {
            const outcome = await this.processListing(
              summary,
              canonicalStoreId,
            );
            if (outcome === 'skipped_wrong_store') skippedWrongStore++;
            else if (outcome === 'skipped_wrong_marketplace')
              skippedWrongMarketplace++;
            else if (outcome === 'skipped_inactive_or_zero_stock')
              skippedInactiveOrZero++;
            else if (outcome === 'skipped_non_english_title')
              skippedNonEnglish++;
            else if (outcome === 'skipped_excluded_brand')
              skippedExcludedBrand++;
            else if (outcome === 'imported') imported++;
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push({ listingId: summary.id, message: msg });
            if (errors.length <= 5 || errors.length % 100 === 0) {
              this.logger.warn(
                `[${syncRunId}] Listing ${summary.id} error #${errors.length}: ${msg.slice(0, 200)}`,
              );
            }
          }
        }

        // Save progress after each page (resume point — 7-day TTL)
        await this.redis.set(`${redisKey}:lastPage`, page, 'EX', 604800);
        await this.redis.hset(redisKey, {
          page: String(page),
          discovered: String(discovered),
          imported: String(imported),
          skippedWrongStore: String(skippedWrongStore),
          skippedWrongMarketplace: String(skippedWrongMarketplace),
          skippedInactiveOrZero: String(skippedInactiveOrZero),
          skippedNonEnglish: String(skippedNonEnglish),
          skippedExcludedBrand: String(skippedExcludedBrand),
          errors: String(errors.length),
          updatedAt: new Date().toISOString(),
        });

        this.logger.log(
          `[${syncRunId}] ${target.name} page ${page}: imported=${imported} discovered=${discovered} skipped(mkt=${skippedWrongMarketplace}, inactive=${skippedInactiveOrZero}, nonEn=${skippedNonEnglish}, brand=${skippedExcludedBrand})`,
        );

        if (discovered >= result.total || result.items.length < result.limit)
          break;
        page++;
      } catch (error) {
        this.logger.error(
          `[${syncRunId}] ${target.name} page ${page} failed: ${error.message}`,
        );
        // Save the failed page so we can retry from it
        await this.redis.hset(redisKey, {
          status: 'error',
          lastError: error.message,
          failedPage: String(page),
        });
        throw error;
      }
    }

    await this.redis.hset(redisKey, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      finalImported: String(imported),
      finalDiscovered: String(discovered),
    });

    return {
      storeId: canonicalStoreId,
      seller: target.name,
      currency: MARKETPLACE_CURRENCY,
      listingsDiscovered: discovered,
      listingsImported: imported,
      skippedWrongStore,
      skippedWrongMarketplace,
      skippedInactiveOrZero,
      skippedNonEnglish,
      skippedExcludedBrand,
      errors,
    };
  }

  private async syncStore(
    storeId: string,
    startPage: number,
    storeSlug?: string,
  ) {
    const target = resolveRealTrackSyncTarget({ storeId, storeSlug });
    const canonicalStoreId = target.storeId!;
    try {
      const result = await this.realTrackService.fetchListings({
        page: startPage,
        limit: 200,
        storeId: canonicalStoreId,
        marketplaceId: BUYER_MARKETPLACE_ID,
      });

      if (result.items.length === 0) {
        this.logger.log(
          `No more listings for ${target.name} (${canonicalStoreId}) at page ${startPage}`,
        );
        return {
          status: 'completed',
          storeId: canonicalStoreId,
          seller: target.name,
          pagesProcessed: startPage,
        };
      }

      let imported = 0;
      let skippedWrongStore = 0;
      let skippedWrongMarketplace = 0;
      let skippedInactiveOrZero = 0;
      let skippedExcludedBrand = 0;
      for (const summary of result.items) {
        try {
          // Use summary data directly — detail endpoint is unreliable
          const outcome = await this.processListing(
            summary,
            canonicalStoreId,
          );
          if (outcome === 'skipped_wrong_store') skippedWrongStore++;
          else if (outcome === 'skipped_wrong_marketplace')
            skippedWrongMarketplace++;
          else if (outcome === 'skipped_inactive_or_zero_stock')
            skippedInactiveOrZero++;
          else if (outcome === 'skipped_excluded_brand')
            skippedExcludedBrand++;
          else if (outcome === 'imported') imported++;
        } catch (error) {
          this.logger.warn(
            `Listing ${summary.id} failed on page sync: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.log(
        `Processed ${imported} listings for ${target.name} (page ${startPage}, skippedWrongStore=${skippedWrongStore}, skippedWrongMarketplace=${skippedWrongMarketplace}, skippedInactiveOrZero=${skippedInactiveOrZero}, skippedExcludedBrand=${skippedExcludedBrand})`,
      );
      return {
        status: 'page_processed',
        storeId: canonicalStoreId,
        seller: target.name,
        page: startPage,
        count: imported,
        skippedWrongStore,
        skippedWrongMarketplace,
        skippedInactiveOrZero,
        skippedExcludedBrand,
        total: result.total,
      };
    } catch (error) {
      this.logger.error(
        `Error syncing store ${canonicalStoreId}: ${error.message}`,
      );
      throw error;
    }
  }

  private async syncMarketplace(marketplaceId: string, startPage: number) {
    // Buyer catalog is eBay Motors US only — refuse other marketplace sync jobs.
    if (
      String(marketplaceId || '')
        .trim()
        .toUpperCase() !== BUYER_MARKETPLACE_ID
    ) {
      this.logger.warn(
        `Refusing marketplace sync for ${marketplaceId}; only ${BUYER_MARKETPLACE_ID} is allowed`,
      );
      return {
        status: 'rejected',
        marketplaceId,
        reason: `Only ${BUYER_MARKETPLACE_ID} is allowed`,
      };
    }
    try {
      const allowedStoreIds = new Set(
        REALTRACK_MARKETPLACE_SELLERS.map((s) => s.storeId!),
      );
      const result = await this.realTrackService.fetchListings({
        page: startPage,
        limit: 200,
        marketplaceId: BUYER_MARKETPLACE_ID,
      });

      if (result.items.length === 0) {
        this.logger.log(
          `No more listings for marketplace ${marketplaceId} at page ${startPage}`,
        );
        return {
          status: 'completed',
          marketplaceId,
          pagesProcessed: startPage,
        };
      }

      let imported = 0;
      let skipped = 0;
      for (const listing of result.items) {
        const storeId = listing.storeId;
        if (!storeId || !allowedStoreIds.has(storeId)) {
          skipped++;
          continue;
        }
        await this.processListing(listing, storeId);
        imported++;
      }

      this.logger.log(
        `Marketplace ${marketplaceId} page ${startPage}: imported ${imported}, skipped other stores ${skipped}`,
      );
      return {
        status: 'page_processed',
        marketplaceId,
        page: startPage,
        count: imported,
        skippedOtherStores: skipped,
        total: result.total,
      };
    } catch (error) {
      this.logger.error(
        `Error syncing marketplace ${marketplaceId}: ${error.message}`,
      );
      throw error;
    }
  }

  /** Sync only the two RealTrack marketplace sellers, staggered (API can't handle concurrent requests). */
  private async syncMarketplaceRealTrackStores() {
    // Stable syncRunId — survives restarts, enables resume
    const syncRunId = 'marketplace-us';
    const existingRun = await this.redis.get('sync:activeRunId');
    const isResume = existingRun === syncRunId;
    await this.redis.set('sync:activeRunId', syncRunId, 'EX', 604800);

    this.logger.log(
      `\n${'='.repeat(60)}\n  SYNC RUN: ${syncRunId}${isResume ? ' (RESUME)' : ' (NEW)'}\n  Monitor: GET /operations/sync/progress/${syncRunId}\n${'='.repeat(60)}`,
    );

    // Run sequentially — RealTrack API returns 500 on concurrent requests
    const results: any[] = [];
    for (const store of REALTRACK_MARKETPLACE_SELLERS) {
      this.logger.log(
        `[${syncRunId}] Syncing ${store.name} ← storeId ${store.storeId}`,
      );
      results.push(
        await this.syncStoreComplete(
          store.storeId!,
          undefined,
          store.storeSlug || undefined,
          syncRunId!,
        ),
      );
    }

    this.logger.log(
      `[${syncRunId}] All stores synced. Running bulk OpenSearch reindex...`,
    );
    await this.bulkReindex();

    // Clear active run
    await this.redis.del('sync:activeRunId');

    this.logger.log(
      `\n${'='.repeat(60)}\n  SYNC RUN ${syncRunId} COMPLETE\n${'='.repeat(60)}`,
    );
    return { status: 'completed', syncRunId, results };
  }

  /** Wipe and rebuild the OpenSearch index from all active DB offers. */
  private async bulkReindex() {
    const { execSync } = require('child_process');
    try {
      this.logger.log('Starting bulk OpenSearch reindex...');
      const output = execSync(
        'node /app/scripts/reindex-active-from-db.mjs',
        { timeout: 600_000, encoding: 'utf-8' },
      );
      const lastLine = output.trim().split('\n').pop();
      this.logger.log(`Bulk reindex complete: ${lastLine}`);
    } catch (error) {
      this.logger.error(`Bulk reindex failed: ${error.message}`);
    }
  }

  /**
   * Import one listing into the seller that owns `expectedStoreId`.
   * Listings whose RealTrack storeId does not match are skipped (never cross-assigned).
   */
  private async processListing(
    listing: any,
    expectedStoreId: string,
  ): Promise<
    | 'imported'
    | 'skipped_wrong_store'
    | 'skipped_wrong_marketplace'
    | 'skipped_no_seller'
    | 'skipped_inactive_or_zero_stock'
    | 'skipped_non_english_title'
    | 'skipped_duplicate'
    | 'skipped_excluded_brand'
  > {
    const listingStoreId = listing.storeId || expectedStoreId;
    if (listing.storeId && listing.storeId !== expectedStoreId) {
      this.logger.warn(
        `Skipping listing ${listing.id}: belongs to store ${listingStoreId}, expected ${expectedStoreId}`,
      );
      return 'skipped_wrong_store';
    }

    if (!isUsMotorsMarketplace(listing)) {
      this.logger.warn(
        `Skipping listing ${listing.id}: marketplace ${listing.marketplaceId || 'missing'} (need ${BUYER_MARKETPLACE_ID})`,
      );
      await this.deactivateOfferForListing(listing, expectedStoreId);
      return 'skipped_wrong_marketplace';
    }

    if (!isImportableListing(listing)) {
      return 'skipped_inactive_or_zero_stock';
    }

    const stockQty = stockQuantityForImport(listing);
    const imageUrls = extractListingImages(listing);
    const title: string = extractEnglishTitle(listing);
    if (!looksLikeEnglishTitle(title)) {
      this.logger.warn(`Skipping listing ${listing.id}: non-English title`);
      await this.deactivateOfferForListing(listing, expectedStoreId);
      return 'skipped_non_english_title';
    }
    const parsedVehicle = parseVehicleFromTitle(title);
    const category = extractCategory(title);
    const oeNumbers = extractListingOeNumbers(listing, extractOeNumbers(title));
    const description = extractListingDescription(listing);
    const brand = extractListingBrand(listing);

    // Skip FEBEST and other exempt brands — they have their own supplier pipeline.
    // Check both the extracted brand and the raw title (brand field is often empty).
    const brandUpper = brand?.toUpperCase().trim();
    if (brandUpper && REALTRACK_EXCLUDED_BRANDS.has(brandUpper)) {
      return 'skipped_excluded_brand';
    }
    for (const excluded of REALTRACK_EXCLUDED_BRANDS) {
      if (title.toUpperCase().startsWith(excluded)) {
        return 'skipped_excluded_brand';
      }
    }

    const mpn =
      (typeof listing.mpn === 'string' && listing.mpn.trim()) ||
      (typeof listing.manufacturerPartNumber === 'string' &&
        listing.manufacturerPartNumber.trim()) ||
      oeNumbers[0] ||
      null;
    let compatibility = buildCompatibility(listing, parsedVehicle);

    await this.prisma.rawStagingListing.upsert({
      where: { sourceListingId: listing.id },
      update: {
        title: listing.title,
        sku: listing.sku,
        price: listing.price ? parseFloat(listing.price) : 0,
        quantity: stockQty,
        status: listing.listingStatus,
        marketplaceId: listing.marketplaceId || BUYER_MARKETPLACE_ID,
        ebayItemId: listing.ebayItemId,
        ebayAccountId: listing.ebayAccountId,
        offerId: listing.offerId,
        listingUrl: listing.listingUrl,
        imageUrls,
        healthFlags: listing.healthFlags || null,
        compatibility:
          compatibility.length > 0
            ? compatibility
            : listing.compatibility || null,
        rawPayload: listing,
        updatedAt: new Date(),
      },
      create: {
        sourceListingId: listing.id,
        storeId: expectedStoreId,
        marketplaceId: listing.marketplaceId || BUYER_MARKETPLACE_ID,
        ebayItemId: listing.ebayItemId,
        ebayAccountId: listing.ebayAccountId,
        offerId: listing.offerId,
        title: listing.title,
        sku: listing.sku,
        price: listing.price ? parseFloat(listing.price) : 0,
        currency: MARKETPLACE_CURRENCY,
        quantity: stockQty,
        status: listing.listingStatus,
        listingUrl: listing.listingUrl,
        imageUrls,
        healthFlags: listing.healthFlags || null,
        compatibility:
          compatibility.length > 0
            ? compatibility
            : listing.compatibility || null,
        rawPayload: listing,
      },
    });

    const seller = await this.prisma.seller.findFirst({
      where: { storeId: expectedStoreId },
      include: { warehouses: true },
    });

    if (!seller) {
      this.logger.warn(
        `Seller for store ${expectedStoreId} not found, skipping normalization.`,
      );
      return 'skipped_no_seller';
    }

    // Merge sibling images only within the same RealTrack store (never cross-seller).
    let mergedImages = imageUrls;
    if (listing.sku) {
      const siblings = await this.prisma.rawStagingListing.findMany({
        where: { sku: listing.sku, storeId: expectedStoreId },
        select: { imageUrls: true },
        take: 20,
      });
      const all = siblings.flatMap((s) => s.imageUrls || []);
      mergedImages = prioritizeEbayImages([...imageUrls, ...all]);
    }

    let canonicalPart = listing.ebayItemId
      ? await this.prisma.canonicalPart.findFirst({
          where: { ebayItemId: listing.ebayItemId },
        })
      : null;

    if (canonicalPart) {
      const combinedImages = prioritizeEbayImages([
        ...(canonicalPart.imageUrls || []),
        ...mergedImages,
      ]);
      canonicalPart = await this.prisma.canonicalPart.update({
        where: { id: canonicalPart.id },
        data: {
          title,
          brand: brand || canonicalPart.brand,
          category: category || canonicalPart.category,
          oeNumbers: oeNumbers.length > 0 ? oeNumbers : canonicalPart.oeNumbers,
          manufacturerPartNumber: mpn || canonicalPart.manufacturerPartNumber,
          description: description || canonicalPart.description,
          imageUrls: combinedImages,
          listingUrl: listing.listingUrl || canonicalPart.listingUrl,
          partType: 'SALVAGE_OEM',
          partSource: 'OEM',
          qualityTier: 'USED',
          compatibility:
            compatibility.length > 0
              ? (compatibility as unknown as Prisma.InputJsonValue)
              : canonicalPart.compatibility === null
                ? Prisma.JsonNull
                : (canonicalPart.compatibility as Prisma.InputJsonValue),
        },
      });
    } else {
      canonicalPart = await this.prisma.canonicalPart.create({
        data: {
          title,
          brand,
          category,
          oeNumbers,
          manufacturerPartNumber: mpn,
          description,
          fitmentFlags: [],
          imageUrls: mergedImages,
          listingUrl: listing.listingUrl || null,
          ebayItemId: listing.ebayItemId || null,
          partType: 'SALVAGE_OEM',
          partSource: 'OEM',
          qualityTier: 'USED',
          compatibility:
            compatibility.length > 0
              ? (compatibility as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
      });
    }

    const sourceKey = `rt:${expectedStoreId}:${listing.id}`;
    let offer =
      (await this.prisma.sellerOffer.findFirst({
        where: { externalOfferId: listing.id },
      })) ||
      (await this.prisma.sellerOffer.findFirst({ where: { sourceKey } }));
    // No-duplicate: same ebay item already offered by this seller → update that offer.
    if (!offer && listing.ebayItemId) {
      offer = await this.prisma.sellerOffer.findFirst({
        where: {
          sellerId: seller.id,
          canonicalPart: { ebayItemId: listing.ebayItemId },
          status: 'ACTIVE',
        },
      });
    }
    const sellerBasePrice = listing.price
      ? parseFloat(listing.price)
      : (offer?.sellerBasePrice ?? offer?.price ?? 0);
    const priceQuote = await this.pricing.quote(
      seller.id,
      canonicalPart.category,
      sellerBasePrice,
    );

    if (offer) {
      offer = await this.prisma.sellerOffer.update({
        where: { id: offer.id },
        data: {
          price: priceQuote.customerPrice,
          sellerBasePrice: priceQuote.sellerBasePrice,
          marketplaceFee: priceQuote.marketplaceFee,
          sellerProceeds: priceQuote.sellerProceeds,
          pricingPolicyId: priceQuote.pricingPolicyId,
          pricingPolicyVersion: priceQuote.pricingPolicyVersion,
          pricedAt: new Date(),
          currency: MARKETPLACE_CURRENCY,
          status: 'ACTIVE',
          canonicalPartId: canonicalPart.id,
          externalOfferId: listing.id,
          sourceKey,
          sellerSku: listing.sku || offer.sellerSku,
          sellerTitle: title,
          partType: 'SALVAGE_OEM',
          partSource: 'OEM',
          qualityTier: 'USED',
          sourceTag: tagFromStoreId(expectedStoreId),
        },
      });
    } else {
      offer = await this.prisma.sellerOffer.create({
        data: {
          sellerId: seller.id,
          canonicalPartId: canonicalPart.id,
          price: priceQuote.customerPrice,
          sellerBasePrice: priceQuote.sellerBasePrice,
          marketplaceFee: priceQuote.marketplaceFee,
          sellerProceeds: priceQuote.sellerProceeds,
          pricingPolicyId: priceQuote.pricingPolicyId,
          pricingPolicyVersion: priceQuote.pricingPolicyVersion,
          pricedAt: new Date(),
          currency: MARKETPLACE_CURRENCY,
          condition: 'USED',
          externalOfferId: listing.id,
          sourceKey,
          sellerSku: listing.sku || null,
          sellerTitle: title,
          status: 'ACTIVE',
          partType: 'SALVAGE_OEM',
          partSource: 'OEM',
          qualityTier: 'USED',
          sourceTag: tagFromStoreId(expectedStoreId),
        },
      });
    }

    if (seller.warehouses.length > 0) {
      const existingInventory = await this.prisma.inventory.findFirst({
        where: { offerId: offer.id, warehouseId: seller.warehouses[0].id },
      });
      if (existingInventory) {
        await this.prisma.inventory.update({
          where: { id: existingInventory.id },
          data: { quantity: stockQty },
        });
      } else {
        await this.prisma.inventory.create({
          data: {
            warehouseId: seller.warehouses[0].id,
            offerId: offer.id,
            quantity: stockQty,
          },
        });
      }
    }

    // Build YMM candidates from eBay catalog rows and/or title parse, then verify via US MVL.
    const ymmCandidates: Array<{
      year: number;
      make: string;
      model: string;
      trim?: string | null;
      engine?: string | null;
      source?: string;
    }> = [];
    for (const row of compatibility) {
      if (!row.make || row.make === '-' || !row.model || row.model === '-')
        continue;
      const year =
        typeof row.year === 'number'
          ? row.year
          : parseInt(String(row.year), 10);
      if (!Number.isFinite(year)) continue;
      ymmCandidates.push({
        year,
        make: row.make,
        model: row.model,
        trim: row.trim === '-' ? null : row.trim,
        engine: row.engine === '-' ? null : row.engine,
        source: row.source || 'ebay',
      });
    }
    if (parsedVehicle && ymmCandidates.length === 0) {
      for (
        let year = parsedVehicle.startYear;
        year <= parsedVehicle.endYear;
        year++
      ) {
        ymmCandidates.push({
          year,
          make: parsedVehicle.make,
          model: parsedVehicle.model,
          source: 'title',
        });
      }
    }

    let fitments: {
      vehicleConfigId: string;
      evidenceLevel: string;
      confidence: number;
    }[] = [];
    const mvlVerified = await this.mvlFitment.verifyCandidates(ymmCandidates);
    if (mvlVerified.configs.length > 0) {
      fitments = await this.mvlFitment.upsertVerifiedFitments({
        canonicalPartId: canonicalPart.id,
        configs: mvlVerified.configs,
        source: compatibility.some((r) => r.source === 'ebay')
          ? 'EBAY_MVL'
          : 'TITLE_MVL',
        reviewer: 'Auto (US MVL verified)',
      });
      compatibility = this.mvlFitment.mergeCompatJson(null, mvlVerified.rows);
      canonicalPart = await this.prisma.canonicalPart.update({
        where: { id: canonicalPart.id },
        data: {
          compatibility: compatibility as unknown as Prisma.InputJsonValue,
          fitmentStatus: 'CONFIRMED',
          fitmentConfidence: 0.9,
          fitmentFlags: [
            ...new Set([...(canonicalPart.fitmentFlags || []), 'MVL_VERIFIED']),
          ],
        },
      });
    } else if (ymmCandidates.length > 0) {
      // Candidates present but not in MVL — keep unverified D-level fitment + raw compat JSON.
      const hasCatalogCompat = compatibility.some((r) => r.source === 'ebay');
      const evidenceLevel = hasCatalogCompat ? 'C' : 'D';
      const confidence = hasCatalogCompat ? 0.6 : 0.4;
      const reviewer = hasCatalogCompat
        ? 'Auto (eBay catalog, MVL miss)'
        : 'Auto (title-inferred, MVL miss)';
      if (parsedVehicle) {
        const vehicleConfig =
          await this.findOrCreateVehicleConfig(parsedVehicle);
        const fitment = await this.prisma.fitment.upsert({
          where: {
            canonicalPartId_vehicleConfigId: {
              canonicalPartId: canonicalPart.id,
              vehicleConfigId: vehicleConfig.id,
            },
          },
          update: {
            evidenceLevel,
            confidence,
            reviewer,
            verificationStatus: 'UNVERIFIED',
          },
          create: {
            canonicalPartId: canonicalPart.id,
            vehicleConfigId: vehicleConfig.id,
            evidenceLevel,
            confidence,
            reviewer,
            verificationStatus: 'UNVERIFIED',
          },
        });
        fitments = [
          {
            vehicleConfigId: fitment.vehicleConfigId,
            evidenceLevel,
            confidence,
          },
        ];
      }
      canonicalPart = await this.prisma.canonicalPart.update({
        where: { id: canonicalPart.id },
        data: {
          compatibility:
            compatibility.length > 0
              ? (compatibility as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          fitmentStatus: 'NOT_VERIFIED',
          fitmentConfidence: confidence,
        },
      });
    }

    // Collect unique make names from all sources so OpenSearch facets are
    // populated even when compatibility JSON is sparse.
    const makes = [...new Set(
      [
        ...(Array.isArray(canonicalPart.compatibility)
          ? (canonicalPart.compatibility as any[]).map((c: any) => c.make).filter(Boolean)
          : []),
        parsedVehicle?.make,
      ].filter(Boolean) as string[],
    )];

    // Skip per-listing OpenSearch indexing during bulk sync — a single
    // bulk reindex runs after all stores finish (much faster overall).
    if (!process.env.SKIP_OS_INDEX_ON_INGEST) {
      await this.searchService.indexPart({
        id: canonicalPart.id,
        title: canonicalPart.title,
        brand: canonicalPart.brand,
        category: canonicalPart.category,
        oeNumbers: canonicalPart.oeNumbers,
        partNumbers: (canonicalPart.oeNumbers || []).map((oe) => ({
          displayNumber: oe,
          normalizedNumber: normalizePartNumber(oe),
          numberType: 'OEM',
        })),
        imageUrls: canonicalPart.imageUrls,
        listingUrl: canonicalPart.listingUrl,
        ebayItemId: canonicalPart.ebayItemId,
        compatibility: canonicalPart.compatibility,
        createdAt: canonicalPart.createdAt,
        fitments,
        offers: [
          {
            id: offer.id,
            price: offer.price,
            condition: offer.condition,
            sellerId: offer.sellerId,
            sellerName: seller.name,
            sourceTag: offer.sourceTag,
          },
        ],
      });
    }

    await this.prisma.rawStagingListing.update({
      where: { sourceListingId: listing.id },
      data: { processed: true },
    });

    return 'imported';
  }

  private async findOrCreateVehicleConfig(vehicle: ParsedVehicle) {
    const make = await this.prisma.vehicleMake.upsert({
      where: { name: vehicle.make },
      update: {},
      create: { name: vehicle.make },
    });

    let model = await this.prisma.vehicleModel.findFirst({
      where: { makeId: make.id, name: vehicle.model },
    });
    if (!model) {
      model = await this.prisma.vehicleModel.create({
        data: { makeId: make.id, name: vehicle.model },
      });
    }

    let generation = await this.prisma.vehicleGeneration.findFirst({
      where: {
        modelId: model.id,
        startYear: { lte: vehicle.endYear },
        endYear: { gte: vehicle.startYear },
      },
    });
    if (!generation) {
      generation = await this.prisma.vehicleGeneration.create({
        data: {
          modelId: model.id,
          name:
            vehicle.startYear === vehicle.endYear
              ? `${vehicle.startYear}`
              : `${vehicle.startYear}-${vehicle.endYear}`,
          startYear: vehicle.startYear,
          endYear: vehicle.endYear,
        },
      });
    }

    let config = await this.prisma.vehicleConfiguration.findFirst({
      where: { generationId: generation.id },
    });
    if (!config) {
      config = await this.prisma.vehicleConfiguration.create({
        data: { generationId: generation.id, market: 'GLOBAL' },
      });
    }

    return config;
  }

  /** Hide any existing buyer offer for a non-US-Motors RealTrack listing. */
  private async deactivateOfferForListing(
    listing: any,
    expectedStoreId: string,
  ) {
    if (!listing?.id) return;
    const sourceKey = `rt:${expectedStoreId}:${listing.id}`;
    const offers = await this.prisma.sellerOffer.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ externalOfferId: listing.id }, { sourceKey }],
      },
      select: { id: true, canonicalPartId: true },
    });
    if (offers.length === 0) return;
    await this.prisma.sellerOffer.updateMany({
      where: { id: { in: offers.map((o) => o.id) } },
      data: { status: 'INACTIVE' },
    });
    for (const offer of offers) {
      try {
        const part = await this.prisma.canonicalPart.findUnique({
          where: { id: offer.canonicalPartId },
          include: {
            offers: { include: { seller: true } },
            partNumbers: true,
          },
        });
        if (part) await this.searchService.indexPart(part);
      } catch (err) {
        this.logger.warn(
          `Failed to reindex after deactivating offer ${offer.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
