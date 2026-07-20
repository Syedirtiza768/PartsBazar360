import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RealTrackService } from '../integration/realtrack.service';
import { PrismaService } from '../../prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import { extractCategory, parseVehicleFromTitle, extractOeNumbers, ParsedVehicle } from './listing-parser.util';
import { normalizePartNumber } from '../catalog-import/part-normalization.util';
import { buildCompatibility, extractListingImages, prioritizeEbayImages } from './listing-enrichment.util';
import {
  isImportableListing,
  MARKETPLACE_CURRENCY,
  stockQuantityForImport,
} from './listing-eligibility.util';
import { Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import {
  REALTRACK_MARKETPLACE_SELLERS,
  resolveRealTrackSyncTarget,
} from '../seed/marketplace-sellers.config';

@Processor('ingestion', {
  concurrency: 2,
})
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly realTrackService: RealTrackService,
    private readonly prisma: PrismaService,
    private readonly searchService: OpenSearchService,
    private readonly pricing: PricingService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    switch (job.name) {
      case 'sync-store': {
        const target = resolveRealTrackSyncTarget({
          storeId: job.data.storeId,
          storeSlug: job.data.storeSlug,
        });
        return this.syncStore(target.storeId!, job.data.page || 1, target.storeSlug || undefined);
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

  async syncStoreComplete(storeId: string, listingLimit?: number, storeSlug?: string) {
    const target = resolveRealTrackSyncTarget({ storeId, storeSlug });
    const canonicalStoreId = target.storeId!;
    let page = 1;
    let discovered = 0;
    let imported = 0;
    let skippedWrongStore = 0;
    let skippedInactiveOrZero = 0;
    const errors: Array<{ listingId?: string; message: string }> = [];
    while (true) {
      const remaining = listingLimit ? listingLimit - discovered : 200;
      if (listingLimit && remaining <= 0) break;
      const result = await this.realTrackService.fetchListings({
        page,
        limit: Math.min(200, remaining),
        storeId: canonicalStoreId,
        storeSlug: target.storeSlug || undefined,
        status: 'ACTIVE',
      });
      if (result.items.length === 0) break;
      discovered += result.items.length;
      for (const summary of result.items) {
        try {
          const detail = await this.realTrackService.fetchListingDetail(canonicalStoreId, summary.id);
          const outcome = await this.processListing({ ...summary, ...detail }, canonicalStoreId);
          if (outcome === 'skipped_wrong_store') skippedWrongStore++;
          else if (outcome === 'skipped_inactive_or_zero_stock') skippedInactiveOrZero++;
          else if (outcome === 'imported') imported++;
        } catch (error) {
          errors.push({ listingId: summary.id, message: error instanceof Error ? error.message : String(error) });
          this.logger.warn(`Listing ${summary.id} failed without stopping store sync`);
        }
      }
      if (discovered >= result.total || result.items.length < result.limit) break;
      page++;
    }
    return {
      storeId: canonicalStoreId,
      seller: target.name,
      currency: MARKETPLACE_CURRENCY,
      listingsDiscovered: discovered,
      listingsImported: imported,
      skippedWrongStore,
      skippedInactiveOrZero,
      errors,
    };
  }

  private async syncStore(storeId: string, startPage: number, storeSlug?: string) {
    const target = resolveRealTrackSyncTarget({ storeId, storeSlug });
    const canonicalStoreId = target.storeId!;
    try {
      const result = await this.realTrackService.fetchListings({
        page: startPage,
        limit: 200,
        storeId: canonicalStoreId,
        storeSlug: target.storeSlug || undefined,
      });

      if (result.items.length === 0) {
        this.logger.log(`No more listings for ${target.name} (${canonicalStoreId}) at page ${startPage}`);
        return { status: 'completed', storeId: canonicalStoreId, seller: target.name, pagesProcessed: startPage };
      }

      let imported = 0;
      let skippedWrongStore = 0;
      for (const listing of result.items) {
        const outcome = await this.processListing(listing, canonicalStoreId);
        if (outcome === 'skipped_wrong_store') skippedWrongStore++;
        else imported++;
      }

      this.logger.log(
        `Processed ${imported} listings for ${target.name} (page ${startPage}, skippedWrongStore=${skippedWrongStore})`,
      );
      return {
        status: 'page_processed',
        storeId: canonicalStoreId,
        seller: target.name,
        page: startPage,
        count: imported,
        skippedWrongStore,
        total: result.total,
      };
    } catch (error) {
      this.logger.error(`Error syncing store ${canonicalStoreId}: ${error.message}`);
      throw error;
    }
  }

  private async syncMarketplace(marketplaceId: string, startPage: number) {
    try {
      const allowedStoreIds = new Set(REALTRACK_MARKETPLACE_SELLERS.map((s) => s.storeId!));
      const result = await this.realTrackService.fetchListings({
        page: startPage,
        limit: 200,
        marketplaceId,
      });

      if (result.items.length === 0) {
        this.logger.log(`No more listings for marketplace ${marketplaceId} at page ${startPage}`);
        return { status: 'completed', marketplaceId, pagesProcessed: startPage };
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
      this.logger.error(`Error syncing marketplace ${marketplaceId}: ${error.message}`);
      throw error;
    }
  }

  /** Sync only the two RealTrack marketplace sellers, each to its own storeId. */
  private async syncMarketplaceRealTrackStores() {
    this.logger.log('Starting marketplace RealTrack sync (Salvage + Blackline only)...');
    const results: Array<Awaited<ReturnType<IngestionProcessor['syncStoreComplete']>>> = [];
    for (const store of REALTRACK_MARKETPLACE_SELLERS) {
      this.logger.log(`Syncing ${store.name} ← storeId ${store.storeId}`);
      results.push(await this.syncStoreComplete(store.storeId!, undefined, store.storeSlug || undefined));
    }
    return { status: 'completed', results };
  }

  /**
   * Import one listing into the seller that owns `expectedStoreId`.
   * Listings whose RealTrack storeId does not match are skipped (never cross-assigned).
   */
  private async processListing(
    listing: any,
    expectedStoreId: string,
  ): Promise<
    'imported' | 'skipped_wrong_store' | 'skipped_no_seller' | 'skipped_inactive_or_zero_stock'
  > {
    const listingStoreId = listing.storeId || expectedStoreId;
    if (listing.storeId && listing.storeId !== expectedStoreId) {
      this.logger.warn(
        `Skipping listing ${listing.id}: belongs to store ${listingStoreId}, expected ${expectedStoreId}`,
      );
      return 'skipped_wrong_store';
    }

    if (!isImportableListing(listing)) {
      return 'skipped_inactive_or_zero_stock';
    }

    const stockQty = stockQuantityForImport(listing);
    const imageUrls = extractListingImages(listing);
    const title: string = listing.title || 'Unknown Part';
    const parsedVehicle = parseVehicleFromTitle(title);
    const category = extractCategory(title);
    const oeNumbers = extractOeNumbers(title);
    const compatibility = buildCompatibility(listing, parsedVehicle);

    await this.prisma.rawStagingListing.upsert({
      where: { sourceListingId: listing.id },
      update: {
        title: listing.title,
        sku: listing.sku,
        price: listing.price ? parseFloat(listing.price) : 0,
        quantity: stockQty,
        status: listing.listingStatus,
        ebayItemId: listing.ebayItemId,
        ebayAccountId: listing.ebayAccountId,
        offerId: listing.offerId,
        listingUrl: listing.listingUrl,
        imageUrls,
        healthFlags: listing.healthFlags || null,
        compatibility: compatibility.length > 0 ? compatibility : listing.compatibility || null,
        rawPayload: listing,
        updatedAt: new Date(),
      },
      create: {
        sourceListingId: listing.id,
        storeId: expectedStoreId,
        marketplaceId: listing.marketplaceId,
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
        compatibility: compatibility.length > 0 ? compatibility : listing.compatibility || null,
        rawPayload: listing,
      },
    });

    const seller = await this.prisma.seller.findFirst({
      where: { storeId: expectedStoreId },
      include: { warehouses: true },
    });

    if (!seller) {
      this.logger.warn(`Seller for store ${expectedStoreId} not found, skipping normalization.`);
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
      ? await this.prisma.canonicalPart.findFirst({ where: { ebayItemId: listing.ebayItemId } })
      : null;

    if (canonicalPart) {
      const combinedImages = prioritizeEbayImages([...(canonicalPart.imageUrls || []), ...mergedImages]);
      canonicalPart = await this.prisma.canonicalPart.update({
        where: { id: canonicalPart.id },
        data: {
          title,
          brand: parsedVehicle?.make || canonicalPart.brand,
          category: category || canonicalPart.category,
          oeNumbers: oeNumbers.length > 0 ? oeNumbers : canonicalPart.oeNumbers,
          imageUrls: combinedImages,
          listingUrl: listing.listingUrl || canonicalPart.listingUrl,
          compatibility: compatibility.length > 0
            ? compatibility as unknown as Prisma.InputJsonValue
            : canonicalPart.compatibility === null
              ? Prisma.JsonNull
              : canonicalPart.compatibility as Prisma.InputJsonValue,
        },
      });
    } else {
      canonicalPart = await this.prisma.canonicalPart.create({
        data: {
          title,
          brand: parsedVehicle?.make || null,
          category,
          oeNumbers,
          fitmentFlags: [],
          imageUrls: mergedImages,
          listingUrl: listing.listingUrl || null,
          ebayItemId: listing.ebayItemId || null,
          compatibility: compatibility.length > 0 ? compatibility as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
        },
      });
    }

    let offer = await this.prisma.sellerOffer.findFirst({
      where: { externalOfferId: listing.id },
    });
    const sellerBasePrice = listing.price
      ? parseFloat(listing.price)
      : offer?.sellerBasePrice ?? offer?.price ?? 0;
    const priceQuote = await this.pricing.quote(seller.id, canonicalPart.category, sellerBasePrice);

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
          status: 'ACTIVE',
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

    let fitments: { vehicleConfigId: string; evidenceLevel: string; confidence: number }[] = [];
    // eBay catalog compatibility (compatibleProducts) is more reliable than title-only.
    const hasCatalogCompat = compatibility.some((r) => r.source === 'ebay');
    const evidenceLevel = hasCatalogCompat ? 'B' : 'D';
    const confidence = hasCatalogCompat ? 0.9 : 0.4;
    const reviewer = hasCatalogCompat ? 'Auto (eBay catalog)' : 'Auto (title-inferred)';

    if (parsedVehicle) {
      const vehicleConfig = await this.findOrCreateVehicleConfig(parsedVehicle);
      const fitment = await this.prisma.fitment.upsert({
        where: {
          canonicalPartId_vehicleConfigId: {
            canonicalPartId: canonicalPart.id,
            vehicleConfigId: vehicleConfig.id,
          },
        },
        update: { evidenceLevel, confidence, reviewer },
        create: {
          canonicalPartId: canonicalPart.id,
          vehicleConfigId: vehicleConfig.id,
          evidenceLevel,
          confidence,
          reviewer,
        },
      });
      fitments = [{ vehicleConfigId: fitment.vehicleConfigId, evidenceLevel, confidence }];
    } else if (hasCatalogCompat) {
      // No title-parsed vehicle, but we have eBay catalog compatibility.
      // Create fitments from the unique make/model/year ranges in compatibility rows.
      const uniqueVehicles = new Map<string, { make: string; model: string; startYear: number; endYear: number }>();
      for (const row of compatibility) {
        if (row.source !== 'ebay' || !row.make || row.make === '-' || !row.model || row.model === '-') continue;
        const year = typeof row.year === 'number' ? row.year : parseInt(String(row.year), 10);
        if (isNaN(year)) continue;
        const key = `${row.make}|${row.model}`.toLowerCase();
        const existing = uniqueVehicles.get(key);
        if (existing) {
          existing.startYear = Math.min(existing.startYear, year);
          existing.endYear = Math.max(existing.endYear, year);
        } else {
          uniqueVehicles.set(key, { make: row.make, model: row.model, startYear: year, endYear: year });
        }
      }
      for (const vehicle of uniqueVehicles.values()) {
        const vehicleConfig = await this.findOrCreateVehicleConfig({
          make: vehicle.make,
          model: vehicle.model,
          startYear: vehicle.startYear,
          endYear: vehicle.endYear,
        } as any);
        const fitment = await this.prisma.fitment.upsert({
          where: {
            canonicalPartId_vehicleConfigId: {
              canonicalPartId: canonicalPart.id,
              vehicleConfigId: vehicleConfig.id,
            },
          },
          update: { evidenceLevel, confidence, reviewer },
          create: {
            canonicalPartId: canonicalPart.id,
            vehicleConfigId: vehicleConfig.id,
            evidenceLevel,
            confidence,
            reviewer,
          },
        });
        fitments.push({ vehicleConfigId: fitment.vehicleConfigId, evidenceLevel, confidence });
      }
    }

    await this.searchService.indexPart({
      id: canonicalPart.id,
      title: canonicalPart.title,
      brand: canonicalPart.brand,
      category: canonicalPart.category,
      oeNumbers: canonicalPart.oeNumbers,
      // Index the OE numbers as primary part numbers too, so a normalized
      // exact match (the `normalizedPartNumbers.keyword` term clause) resolves
      // ingested parts — not just the fuzzy multi_match on `oeNumbers`. The
      // RealTrack/eBay feed carries no interchange (OEM_CROSS_REFERENCE)
      // numbers, so there are none to index here; interchange search for
      // ingested parts needs a cross-reference source first.
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
      offers: [{
        id: offer.id,
        price: offer.price,
        condition: offer.condition,
        sellerId: offer.sellerId,
        sellerName: seller.name,
      }],
    });

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
          name: vehicle.startYear === vehicle.endYear
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
}
