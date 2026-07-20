import { PrismaService } from '../../prisma.service';
import { MARKETPLACE_SELLERS, REALTRACK_MARKETPLACE_SELLERS } from './marketplace-sellers.config';

/**
 * Wipe all offers/inventory for Salvage, Blackline, and Superior so a fresh
 * seed can repopulate active in-stock USD listings only.
 */
export async function wipeMarketplaceSellerInventory(prisma: PrismaService) {
  const sellers = await prisma.seller.findMany({
    where: {
      OR: [
        { id: { in: Object.values(MARKETPLACE_SELLERS).map((s) => s.id) } },
        { name: { in: Object.values(MARKETPLACE_SELLERS).map((s) => s.name) } },
        {
          storeId: {
            in: REALTRACK_MARKETPLACE_SELLERS.map((s) => s.storeId!).filter(Boolean),
          },
        },
      ],
    },
    select: { id: true, name: true, storeId: true },
  });

  const sellerIds = sellers.map((s) => s.id);
  if (sellerIds.length === 0) {
    return { sellers: [], deletedOffers: 0, deletedStaging: 0, deletedUploadJobs: 0 };
  }

  const offers = await prisma.sellerOffer.findMany({
    where: { sellerId: { in: sellerIds } },
    select: { id: true },
  });
  const offerIds = offers.map((o) => o.id);

  if (offerIds.length > 0) {
    await prisma.cartItem.deleteMany({ where: { sellerOfferId: { in: offerIds } } });
    await prisma.orderItem.deleteMany({ where: { sellerOfferId: { in: offerIds } } });
    await prisma.salvageUnit.deleteMany({ where: { sellerOfferId: { in: offerIds } } });
    await prisma.inventory.deleteMany({ where: { offerId: { in: offerIds } } });
    await prisma.offerPrice.deleteMany({ where: { offerId: { in: offerIds } } });
    await prisma.sellerUploadRow.updateMany({
      where: { sellerOfferId: { in: offerIds } },
      data: { sellerOfferId: null },
    });
    await prisma.sourceRecord.updateMany({
      where: { sellerOfferId: { in: offerIds } },
      data: { sellerOfferId: null },
    });
    await prisma.supportTicket.updateMany({
      where: { sellerOfferId: { in: offerIds } },
      data: { sellerOfferId: null },
    });
  }

  const deletedOffers = await prisma.sellerOffer.deleteMany({
    where: { sellerId: { in: sellerIds } },
  });

  const storeIds = REALTRACK_MARKETPLACE_SELLERS.map((s) => s.storeId!);
  const deletedStaging = await prisma.rawStagingListing.deleteMany({
    where: { storeId: { in: storeIds } },
  });

  // Superior spreadsheet jobs (rows cascade)
  const superior = sellers.find((s) => s.name === MARKETPLACE_SELLERS.superior.name);
  let deletedUploadJobs = 0;
  if (superior) {
    const jobs = await prisma.sellerUploadJob.deleteMany({ where: { sellerId: superior.id } });
    deletedUploadJobs = jobs.count;
  }

  return {
    sellers,
    deletedOffers: deletedOffers.count,
    deletedStaging: deletedStaging.count,
    deletedUploadJobs,
  };
}
