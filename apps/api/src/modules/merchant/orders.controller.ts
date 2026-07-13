import { Controller, Get, Post, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Controller('merchant/orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getOrders(@Query('sellerId') sellerId: string) {
    if (!sellerId) throw new NotFoundException('sellerId query parameter is required');
    return this.prisma.sellerOrder.findMany({
      where: { sellerId },
      include: {
        items: {
          include: { sellerOffer: { include: { canonicalPart: true } } }
        },
        parentOrder: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Post(':sellerOrderId/fulfill')
  async fulfillOrder(
    @Param('sellerOrderId') sellerOrderId: string,
    @Query('sellerId') sellerId: string,
    @Body() body: { trackingNumber: string, carrier: string }
  ) {
    const order = await this.prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, sellerId }
    });

    if (!order) throw new NotFoundException('Order not found');

    return this.prisma.sellerOrder.update({
      where: { id: sellerOrderId },
      data: {
        status: 'SHIPPED',
        trackingNumber: body.trackingNumber,
        carrier: body.carrier
      }
    });
  }
}
