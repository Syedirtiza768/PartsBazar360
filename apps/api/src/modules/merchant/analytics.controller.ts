import { Controller, Get, Query, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Controller('merchant/analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async getSummary(@Query('sellerId') sellerId: string) {
    if (!sellerId) throw new NotFoundException('sellerId query parameter is required');

    const [activeOffers, pendingOrders, aggregates] = await Promise.all([
      this.prisma.sellerOffer.count({
        where: { sellerId, status: 'ACTIVE' },
      }),
      this.prisma.sellerOrder.count({
        where: { sellerId, status: 'PROCESSING' },
      }),
      this.prisma.sellerOrder.aggregate({
        where: {
          sellerId,
          status: { notIn: ['AWAITING_PAYMENT', 'CANCELLED'] },
        },
        _sum: {
          subTotal: true,
          shippingTotal: true,
          marketplaceFeeTotal: true,
          sellerProceedsTotal: true,
        },
      }),
    ]);

    const subTotal = aggregates._sum.subTotal || 0;
    const shippingTotal = aggregates._sum.shippingTotal || 0;
    const marketplaceFees = aggregates._sum.marketplaceFeeTotal || 0;
    const sellerProceedsBase = aggregates._sum.sellerProceedsTotal || 0;
    const grossSales = subTotal + shippingTotal;
    const sellerProceeds = sellerProceedsBase + shippingTotal;

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
