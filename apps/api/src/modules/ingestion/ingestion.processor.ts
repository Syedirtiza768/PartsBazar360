import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RealTrackService } from '../integration/realtrack.service';
import { PrismaService } from '../../prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import { extractCategory, parseVehicleFromTitle, extractOeNumbers, ParsedVehicle } from './listing-parser.util';

@Processor('ingestion', {
  concurrency: 2,
})
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly realTrackService: RealTrackService,
    private readonly prisma: PrismaService,
    private readonly searchService: OpenSearchService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    switch (job.name) {
      case 'sync-store':
        return this.syncStore(job.data.storeId, job.data.page || 1);
      case 'sync-marketplace':
        return this.syncMarketplace(job.data.marketplaceId, job.data.page || 1);
      case 'sync-all-us':
        return this.syncAllUSStores();
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        return;
    }
  }

  private async syncStore(storeId: string, startPage: number) {
    try {
      const result = await this.realTrackService.fetchListings({ page: startPage, limit: 200, storeId });

      if (result.items.length === 0) {
        this.logger.log(`No more listings for store ${storeId} at page ${startPage}`);
        return { status: 'completed', storeId, pagesProcessed: startPage };
      }

      for (const listing of result.items) {
        await this.processListing(listing, storeId);
      }

      this.logger.log(`Successfully processed ${result.items.length} listings for store ${storeId} (page ${startPage})`);
      return { status: 'page_processed', storeId, page: startPage, count: result.items.length, total: result.total };
    } catch (error) {
      this.logger.error(`Error syncing store ${storeId}: ${error.message}`);
      throw error;
    }
  }

  private async syncMarketplace(marketplaceId: string, startPage: number) {
    try {
      const result = await this.realTrackService.fetchListings({
        page: startPage,
        limit: 200,
        marketplaceId,
      });

      if (result.items.length === 0) {
        this.logger.log(`No more listings for marketplace ${marketplaceId} at page ${startPage}`);
        return { status: 'completed', marketplaceId, pagesProcessed: startPage };
      }

      for (const listing of result.items) {
        await this.processListing(listing, listing.storeId);
      }

      this.logger.log(`Successfully processed ${result.items.length} listings for marketplace ${marketplaceId} (page ${startPage})`);
      return { status: 'page_processed', marketplaceId, page: startPage, count: result.items.length, total: result.total };
    } catch (error) {
      this.logger.error(`Error syncing marketplace ${marketplaceId}: ${error.message}`);
      throw error;
    }
  }

  private async syncAllUSStores() {
    this.logger.log('Starting full US marketplace sync...');

    // All 11 stores
    const stores = [
      { id: '79f249a5-31e0-42a8-978c-a99b0665c61b', name: 'All About Mercedes' },
      { id: 'fa528c8a-f249-4816-94f6-f2ce8b932449', name: 'B.JLRWORLD' },
      { id: 'd16199c4-55b5-429e-ad27-892bed94e00d', name: 'BLACKLINEAUTOPARTS' },
      { id: '5fc75f19-31f3-44e4-b1ae-6545055f7945', name: 'K. Brit Auto Depot - UK' },
      { id: '65aff8ec-21ee-460f-af17-20daa0b843c1', name: 'K. Euro Japan Auto Parts' },
      { id: 'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0', name: 'K. Salvage Auto Parts' },
      { id: 'cc658cc0-ab21-4519-9f06-4aea8ff6a809', name: 'K. Salvage Dismantlers - DE' },
      { id: '7658e52e-4dd6-48a7-ad78-6933630bdac7', name: 'K. Southern Cross Auto Parts - AU' },
      { id: 'cfcc4a9c-c41b-4166-ab41-989c00a6fad1', name: 'Primemotive' },
      { id: '8d7d8b23-d769-4ed5-91e2-e26d14a45215', name: 'VW & RR' },
      { id: '70ad5c44-6424-4998-815c-99adf28c2487', name: 'eBay store' },
    ];

    let totalProcessed = 0;

    for (const store of stores) {
      this.logger.log(`Syncing store: ${store.name} (${store.id})`);
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        try {
          const result = await this.realTrackService.fetchListings({
            page,
            limit: 200,
            storeId: store.id,
          });

          if (result.items.length === 0) {
            hasMore = false;
            break;
          }

          for (const listing of result.items) {
            await this.processListing(listing, store.id);
          }

          totalProcessed += result.items.length;
          this.logger.log(`Progress: ${totalProcessed} total listings processed (current store: ${store.name}, page: ${page})`);

          if (result.items.length < 200) {
            hasMore = false;
          } else {
            page++;
          }
        } catch (error) {
          this.logger.error(`Error syncing store ${store.name}: ${error.message}`);
          hasMore = false;
        }
      }
    }

    return { status: 'completed', totalProcessed };
  }

  private async processListing(listing: any, storeId: string) {
    // 1. Idempotent save to RawStagingListing
    await this.prisma.rawStagingListing.upsert({
      where: { sourceListingId: listing.id },
      update: {
        title: listing.title,
        sku: listing.sku,
        price: listing.price ? parseFloat(listing.price) : 0,
        quantity: listing.quantityAvailable || 1,
        status: listing.listingStatus,
        ebayItemId: listing.ebayItemId,
        ebayAccountId: listing.ebayAccountId,
        offerId: listing.offerId,
        listingUrl: listing.listingUrl,
        imageUrls: Array.isArray(listing.imageUrls) ? listing.imageUrls : [],
        healthFlags: listing.healthFlags || null,
        compatibility: listing.compatibility || null,
        rawPayload: listing,
        updatedAt: new Date(),
      },
      create: {
        sourceListingId: listing.id,
        storeId: storeId,
        marketplaceId: listing.marketplaceId,
        ebayItemId: listing.ebayItemId,
        ebayAccountId: listing.ebayAccountId,
        offerId: listing.offerId,
        title: listing.title,
        sku: listing.sku,
        price: listing.price ? parseFloat(listing.price) : 0,
        currency: listing.currency,
        quantity: listing.quantityAvailable || 1,
        status: listing.listingStatus,
        listingUrl: listing.listingUrl,
        imageUrls: Array.isArray(listing.imageUrls) ? listing.imageUrls : [],
        healthFlags: listing.healthFlags || null,
        compatibility: listing.compatibility || null,
        rawPayload: listing,
      },
    });

    // 2. Map to Seller
    const seller = await this.prisma.seller.findFirst({
      where: { storeId },
      include: { warehouses: true }
    });

    if (!seller) {
      this.logger.warn(`Seller for store ${storeId} not found, skipping normalization.`);
      return;
    }

    // 3. Best-effort normalization from the raw title (year/make/model, category)
    const title: string = listing.title || 'Unknown Part';
    const parsedVehicle = parseVehicleFromTitle(title);
    const category = extractCategory(title);
    const oeNumbers = extractOeNumbers(title);

    const canonicalPart = await this.prisma.canonicalPart.create({
      data: {
        title,
        brand: parsedVehicle?.make || null,
        category,
        oeNumbers,
        fitmentFlags: [],
        imageUrls: Array.isArray(listing.imageUrls) ? listing.imageUrls : [],
        listingUrl: listing.listingUrl || null,
        ebayItemId: listing.ebayItemId || null,
        compatibility: listing.compatibility || null,
      }
    });

    // 4. Create Seller Offer & Inventory
    const offer = await this.prisma.sellerOffer.create({
      data: {
        sellerId: seller.id,
        canonicalPartId: canonicalPart.id,
        price: listing.price ? parseFloat(listing.price) : 0,
        currency: listing.currency || 'AED',
        condition: 'USED', // Assume used for salvage parts
        externalOfferId: listing.id,
        // Normalize to the app's internal convention (ACTIVE/ENDED/...) — RealTrack
        // returns lowercase statuses (e.g. "active") which otherwise silently fail
        // the status === 'ACTIVE' checks used by cart/checkout/analytics.
        status: (listing.listingStatus || 'active').toUpperCase(),
      }
    });

    if (seller.warehouses.length > 0) {
      await this.prisma.inventory.create({
        data: {
          warehouseId: seller.warehouses[0].id,
          offerId: offer.id,
          quantity: listing.quantityAvailable || 1,
        }
      });
    }

    // 5. Best-effort vehicle fitment inferred from the title (unverified — evidenceLevel 'D')
    let fitments: { vehicleConfigId: string }[] = [];
    if (parsedVehicle) {
      const vehicleConfig = await this.findOrCreateVehicleConfig(parsedVehicle);
      const fitment = await this.prisma.fitment.upsert({
        where: {
          canonicalPartId_vehicleConfigId: {
            canonicalPartId: canonicalPart.id,
            vehicleConfigId: vehicleConfig.id,
          },
        },
        update: {},
        create: {
          canonicalPartId: canonicalPart.id,
          vehicleConfigId: vehicleConfig.id,
          evidenceLevel: 'D', // title-inferred, unverified
          confidence: 0.4,
          reviewer: 'Auto (title-inferred)',
        },
      });
      fitments = [{ vehicleConfigId: fitment.vehicleConfigId }];
    }

    // 6. Index into OpenSearch so the part is immediately searchable
    await this.searchService.indexPart({
      id: canonicalPart.id,
      title: canonicalPart.title,
      brand: canonicalPart.brand,
      category: canonicalPart.category,
      oeNumbers: canonicalPart.oeNumbers,
      imageUrls: canonicalPart.imageUrls,
      listingUrl: canonicalPart.listingUrl,
      ebayItemId: canonicalPart.ebayItemId,
      compatibility: canonicalPart.compatibility,
      createdAt: canonicalPart.createdAt,
      fitments,
      offers: [{ id: offer.id, price: offer.price, condition: offer.condition, sellerId: offer.sellerId }],
    });

    // Mark as processed
    await this.prisma.rawStagingListing.update({
      where: { sourceListingId: listing.id },
      data: { processed: true }
    });
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

    // Prefer a generation whose range overlaps the parsed year(s), so that a
    // "2012 Jetta" listing can attach to an existing "2011-2018 Jetta"
    // generation instead of creating a redundant single-year record.
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
          name: vehicle.startYear === vehicle.endYear ? `${vehicle.startYear}` : `${vehicle.startYear}-${vehicle.endYear}`,
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
