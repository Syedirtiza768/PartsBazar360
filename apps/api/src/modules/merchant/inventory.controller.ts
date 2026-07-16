import { Controller, Get, Patch, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PricingService } from '../pricing/pricing.service';

@Controller('merchant/inventory')
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  @Get()
  async getInventory(@Query('sellerId') sellerId: string) {
    if (!sellerId) throw new NotFoundException('sellerId query parameter is required');
    return this.prisma.sellerOffer.findMany({
      where: { sellerId },
      include: {
        canonicalPart: true,
        inventory: true
      }
    });
  }

  @Patch(':offerId')
  async updateOffer(
    @Param('offerId') offerId: string,
    @Query('sellerId') sellerId: string,
    @Body() body: { price?: number, status?: string }
  ) {
    // Basic verification that the offer belongs to the seller
    const offer = await this.prisma.sellerOffer.findFirst({
      where: { id: offerId, sellerId }
    });

    if (!offer) throw new NotFoundException('Offer not found');

    if (body.status !== undefined) {
      await this.prisma.sellerOffer.update({ where: { id: offerId }, data: { status: body.status } });
    }
    if (body.price !== undefined) return this.pricing.repriceOffer(offerId, Number(body.price));
    return this.prisma.sellerOffer.findUnique({
      where: { id: offerId },
      include: { canonicalPart: true, inventory: true, pricingPolicy: true },
    });
  }
}
