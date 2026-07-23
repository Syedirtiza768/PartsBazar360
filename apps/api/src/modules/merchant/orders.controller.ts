import { Controller, Get, Post, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Controller('merchant/orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getOrders(
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
      this.prisma.sellerOrder.findMany({
        where,
        include: {
          items: {
            include: {
              sellerOffer: {
                include: {
                  canonicalPart: {
                    select: { id: true, title: true, imageUrls: true },
                  },
                },
              },
            },
          },
          parentOrder: {
            select: { id: true, status: true, createdAt: true, currency: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.sellerOrder.count({ where }),
    ]);

    return { items, total, page: pageNum, limit: take };
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
