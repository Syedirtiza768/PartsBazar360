import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TamaraService, type TamaraCurrency } from '../checkout/tamara.service';

@Controller('merchant/orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tamaraService: TamaraService,
  ) {}

  @Get()
  async getOrders(
    @Query('sellerId') sellerId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!sellerId)
      throw new NotFoundException('sellerId query parameter is required');

    const pageNum = Math.max(1, page ? parseInt(page, 10) || 1 : 1);
    const take = Math.min(
      Math.max(1, limit ? parseInt(limit, 10) || 50 : 50),
      200,
    );
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
    @Body() body: { trackingNumber: string; carrier: string },
  ) {
    const order = await this.prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, sellerId },
      include: {
        parentOrder: { include: { paymentIntent: true } },
        items: {
          include: {
            sellerOffer: {
              include: { canonicalPart: { select: { title: true } } },
            },
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'SHIPPED') return order;

    const payment = order.parentOrder.paymentIntent;
    if (payment?.provider === 'tamara') {
      if (!payment.externalId) {
        throw new BadRequestException('Tamara order ID is missing');
      }
      if (payment.status !== 'SUCCEEDED') {
        throw new BadRequestException(
          'Tamara payment must be authorised before shipment',
        );
      }
      if (!['AED', 'SAR'].includes(payment.currency)) {
        throw new BadRequestException('Unsupported Tamara order currency');
      }

      await this.tamaraService.captureOrder({
        orderId: payment.externalId,
        amount:
          Math.round((order.subTotal + order.shippingTotal) * 100) / 100,
        shippingAmount: order.shippingTotal,
        currency: payment.currency as TamaraCurrency,
        shippedAt: new Date(),
        shippingCompany: body.carrier,
        trackingNumber: body.trackingNumber,
        items: order.items.map((item) => ({
          referenceId: item.sellerOfferId,
          name:
            item.sellerOffer.canonicalPart?.title ||
            item.sellerOffer.sellerTitle ||
            'Auto part',
          sku:
            item.sellerOffer.sellerSku ||
            item.sellerOffer.externalOfferId ||
            item.sellerOfferId,
          quantity: item.quantity,
          unitAmount: item.unitPrice,
          totalAmount:
            Math.round(item.unitPrice * item.quantity * 100) / 100,
        })),
      });
    }

    return this.prisma.sellerOrder.update({
      where: { id: sellerOrderId },
      data: {
        status: 'SHIPPED',
        trackingNumber: body.trackingNumber,
        carrier: body.carrier,
      },
    });
  }
}
