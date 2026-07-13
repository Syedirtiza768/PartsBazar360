import { PrismaClient } from '@prisma/client';
import { RealTrackService } from './src/modules/integration/realtrack.service';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

async function main() {
  console.log('Starting seed...');

  // 1. Create an Organization
  const org = await prisma.organization.create({
    data: {
      name: 'PartsBazar360 Initial Merchants',
    },
  });

  // 2. Create the Seller mapped to the RealTrack store
  const storeId = '79f249a5-31e0-42a8-978c-a99b0665c61b'; // All About Mercedes
  const seller = await prisma.seller.create({
    data: {
      organizationId: org.id,
      name: 'All About Mercedes',
      storeId: storeId,
    },
  });

  // 3. Create a Warehouse for the Seller
  const warehouse = await prisma.warehouse.create({
    data: {
      sellerId: seller.id,
      name: 'Main DXB Warehouse',
      location: 'Dubai',
    },
  });

  console.log(`Created Seller: ${seller.name} with Warehouse: ${warehouse.name}`);

  // 4. Trigger the mock API to simulate initial data ingestion
  console.log('Running Ingestion Sync Job with Live RealTrack API...');
  const realTrackService = new RealTrackService();
  const listings = await realTrackService.fetchListings(1, 5, storeId);

  for (const listing of listings) {
    console.log(`Ingesting listing: ${listing.title}`);
    
    // Save to Raw Staging
    await prisma.rawStagingListing.create({
      data: {
        sourceListingId: listing.id,
        storeId: listing.storeId || storeId,
        marketplaceId: listing.marketplaceId,
        title: listing.title,
        sku: listing.sku,
        price: listing.price ? parseFloat(listing.price) : 0,
        currency: listing.currency,
        quantity: listing.quantityAvailable || 1,
        status: listing.listingStatus,
        rawPayload: listing,
        processed: true, // Marking processed as we normalize directly in this seed
      },
    });

    // Create Canonical Part
    const canonicalPart = await prisma.canonicalPart.create({
      data: {
        title: listing.title,
        brand: 'Mercedes',
      },
    });

    // Create Seller Offer
    const offer = await prisma.sellerOffer.create({
      data: {
        sellerId: seller.id,
        canonicalPartId: canonicalPart.id,
        price: listing.price ? parseFloat(listing.price) : 0,
        currency: listing.currency,
        condition: 'USED',
        externalOfferId: listing.id,
      },
    });

    // Create Inventory
    await prisma.inventory.create({
      data: {
        warehouseId: warehouse.id,
        offerId: offer.id,
        quantity: listing.quantity,
      },
    });
  }

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
