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

    const paidOrders = orders.filter(o => !['AWAITING_PAYMENT', 'CANCELLED'].includes(o.status));
    const pendingOrders = paidOrders.filter(o => o.status === 'PROCESSING').length;
    const grossSales = paidOrders.reduce((sum, o) => sum + o.subTotal + o.shippingTotal, 0);
    const marketplaceFees = paidOrders.reduce((sum, o) => sum + o.marketplaceFeeTotal, 0);
    const sellerProceeds = paidOrders.reduce((sum, o) => sum + o.sellerProceedsTotal + o.shippingTotal, 0);

    return {
      activeListings: activeOffers,
      pendingOrders,
      totalRevenue: sellerProceeds,
      grossSales,
      marketplaceFees,
      sellerProceeds,
    };
  }
}
