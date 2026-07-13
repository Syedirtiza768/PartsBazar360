import { Controller, Get, Query, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Controller('merchant/analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async getSummary(@Query('sellerId') sellerId: string) {
    if (!sellerId) throw new NotFoundException('sellerId query parameter is required');

    const orders = await this.prisma.sellerOrder.findMany({
      where: { sellerId }
    });

    const activeOffers = await this.prisma.sellerOffer.count({
      where: { sellerId, status: 'ACTIVE' }
    });

    const pendingOrders = orders.filter(o => o.status === 'PROCESSING').length;
    const totalRevenue = orders
      .filter(o => o.status !== 'CANCELLED')
      .reduce((sum, o) => sum + o.subTotal + o.shippingTotal, 0);

    return {
      activeListings: activeOffers,
      pendingOrders,
      totalRevenue
    };
  }
}
