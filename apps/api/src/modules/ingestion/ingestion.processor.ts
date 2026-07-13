import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RealTrackService } from '../integration/realtrack.service';
import { PrismaService } from '../../prisma.service';

@Processor('ingestion', {
  concurrency: 2, // BullMQ recommended concurrency practice
})
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly realTrackService: RealTrackService,
    private readonly prisma: PrismaService,
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

    // 3. Normalize into CanonicalPart
    const canonicalPart = await this.prisma.canonicalPart.create({
      data: {
        title: listing.title,
        brand: 'Extracted Brand', // Placeholder for actual extraction logic
        category: 'Extracted Category',
        oeNumbers: [],
        fitmentFlags: [],
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
        status: listing.listingStatus || 'ACTIVE'
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

    // Mark as processed
    await this.prisma.rawStagingListing.update({
      where: { sourceListingId: listing.id },
      data: { processed: true }
    });
  }
}
