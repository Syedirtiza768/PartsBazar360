import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TamaraService, type TamaraCurrency } from '../checkout/tamara.service';
import { roundMoney } from '../checkout/currency.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SellerId } from '../auth/seller-id.decorator';

@Controller('merchant/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tamaraService: TamaraService,
  ) {}

  @Get()
  async getOrders(
    @SellerId() sellerId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
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
    @SellerId() sellerId: string,
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

      const itemSubtotals = order.items.map((item) =>
        roundMoney(item.unitPrice * item.quantity),
      );
      const sellerSubtotal = itemSubtotals.reduce(
        (sum, value) => sum + value,
        0,
      );
      let allocatedDiscount = 0;
      const captureItems = order.items.map((item, index) => {
        const discountAmount =
          index === order.items.length - 1
            ? roundMoney(order.discountTotal - allocatedDiscount)
            : roundMoney(
                sellerSubtotal > 0
                  ? (order.discountTotal * itemSubtotals[index]) /
                      sellerSubtotal
                  : 0,
              );
        allocatedDiscount += discountAmount;
        return {
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
          totalAmount: itemSubtotals[index],
          discountAmount,
        };
      });

      await this.tamaraService.captureOrder({
        orderId: payment.externalId,
        amount: roundMoney(
          order.subTotal - order.discountTotal + order.shippingTotal,
        ),
        shippingAmount: order.shippingTotal,
        currency: payment.currency as TamaraCurrency,
        shippedAt: new Date(),
        shippingCompany: body.carrier,
        trackingNumber: body.trackingNumber,
        items: captureItems,
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
