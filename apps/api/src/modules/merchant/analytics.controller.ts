import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SellerId } from '../auth/seller-id.decorator';

@Controller('merchant/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async getSummary(@SellerId() sellerId: string) {
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
