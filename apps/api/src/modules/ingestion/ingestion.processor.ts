import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RealTrackService } from '../integration/realtrack.service';
import { PrismaService } from '../../prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import { extractCategory, parseVehicleFromTitle, extractOeNumbers, ParsedVehicle } from './listing-parser.util';

@Processor('ingestion', {
  concurrency: 2, // BullMQ recommended concurrency practice
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
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        return;
    }
  }

  private async syncStore(storeId: string, startPage: number) {
    let currentPage = startPage;
    let hasMore = true;

    // We fetch one page per job to keep jobs small, and spawn the next page if needed
    try {
      const listings = await this.realTrackService.fetchListings(currentPage, 200, storeId);
      
      if (listings.length === 0) {
        this.logger.log(`No more listings for store ${storeId} at page ${currentPage}`);
        return { status: 'completed', storeId, pagesProcessed: currentPage };
      }

      for (const listing of listings) {
        await this.processListing(listing, storeId);
      }

      this.logger.log(`Successfully processed ${listings.length} listings for store ${storeId} (page ${currentPage})`);

      // In a real scenario, we might enqueue the next page here
      // For this seed/prototype, we'll just process one page.
      return { status: 'page_processed', storeId, page: currentPage, count: listings.length };
    } catch (error) {
      this.logger.error(`Error syncing store ${storeId}: ${error.message}`);
      throw error;
    }
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
        rawPayload: listing,
        updatedAt: new Date(),
      },
      create: {
        sourceListingId: listing.id,
        storeId: storeId,
        marketplaceId: listing.marketplaceId,
        title: listing.title,
        sku: listing.sku,
        price: listing.price ? parseFloat(listing.price) : 0,
        currency: listing.currency,
        quantity: listing.quantityAvailable || 1,
        status: listing.listingStatus,
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
