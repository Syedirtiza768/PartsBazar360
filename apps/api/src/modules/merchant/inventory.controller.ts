import { Controller, Get, Patch, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { BuyerCacheService } from '../search/buyer-cache.service';

@Controller('merchant/inventory')
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly buyerCache: BuyerCacheService,
  ) {}

  @Get()
  async getInventory(
    @Query('sellerId') sellerId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!sellerId) throw new NotFoundException('sellerId query parameter is required');

    const pageNum = Math.max(1, page ? parseInt(page, 10) || 1 : 1);
    const take = Math.min(Math.max(1, limit ? parseInt(limit, 10) || 50 : 50), 200);
    const skip = (pageNum - 1) * take;

    const where = { sellerId };
    const [items, total] = await Promise.all([
      this.prisma.sellerOffer.findMany({
        where,
        include: {
          canonicalPart: {
            select: {
              id: true,
              title: true,
              imageUrls: true,
              brand: true,
              manufacturerPartNumber: true,
            },
          },
          inventory: { select: { quantity: true, status: true, warehouseId: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.sellerOffer.count({ where }),
    ]);

    return { items, total, page: pageNum, limit: take };
  }

  @Patch(':offerId')
  async updateOffer(
    @Param('offerId') offerId: string,
    @Query('sellerId') sellerId: string,
    @Body() body: { price?: number; status?: string },
  ) {
    const offer = await this.prisma.sellerOffer.findFirst({
      where: { id: offerId, sellerId },
    });

    if (!offer) throw new NotFoundException('Offer not found');

    if (body.status !== undefined) {
      await this.prisma.sellerOffer.update({ where: { id: offerId }, data: { status: body.status } });
    }

    let result;
    if (body.price !== undefined) {
      result = await this.pricing.repriceOffer(offerId, Number(body.price));
    } else {
      result = await this.prisma.sellerOffer.findUnique({
        where: { id: offerId },
        include: { canonicalPart: true, inventory: true, pricingPolicy: true },
      });
    }

    void this.buyerCache.revalidatePart(offer.canonicalPartId);
    return result;
  }
}
