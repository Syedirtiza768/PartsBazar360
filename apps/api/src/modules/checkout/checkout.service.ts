import { Injectable, BadRequestException, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { CartService } from '../cart/cart.service';
import { ReservationService } from '../inventory/reservation.service';
import { OrderService } from '../order/order.service';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private cartService: CartService,
    private reservationService: ReservationService,
    private orderService: OrderService,
    private shippingService: ShippingService,
    private prisma: PrismaService,
  ) {}

  async processCheckout(
    cartId: string,
    buyer: { buyerId?: string; email?: string; name?: string },
    shippingAddress: any,
  ) {
    const cart = await this.cartService.getCart(cartId);

    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const buyerId = await this.resolveBuyerId(buyer);

    // 1. Lock stock for all items
    const reservedOffers: string[] = [];
    for (const item of cart.items) {
      const locked = await this.reservationService.reserveStock(cartId, item.sellerOfferId, item.quantity);
      if (!locked) {
        // Rollback any successful locks if one fails
        for (const reservedOfferId of reservedOffers) {
          await this.reservationService.releaseStock(cartId, reservedOfferId);
        }
        throw new BadRequestException(`Failed to reserve stock for offer ${item.sellerOfferId}. It might be sold out.`);
      }
      reservedOffers.push(item.sellerOfferId);
    }

    // 2. Calculate Shipping per Seller
    const itemsBySeller = cart.items.reduce((acc, item) => {
      const sellerId = item.sellerOffer.sellerId;
      if (!acc[sellerId]) acc[sellerId] = [];
      acc[sellerId].push(item);
      return acc;
    }, {} as Record<string, typeof cart.items>);

    const shippingTotalsBySeller: Record<string, number> = {};
    for (const [sellerId, items] of Object.entries(itemsBySeller)) {
      const formattedItemsForShipping = items.map(i => ({
        weight: i.sellerOffer.canonicalPart?.weight ?? undefined,
        quantity: i.quantity
      }));
      shippingTotalsBySeller[sellerId] = this.shippingService.calculateSellerShippingTotal(formattedItemsForShipping);
    }

    // 3. Create Multi-Seller Order
    const order = await this.orderService.createMultiSellerOrder(buyerId, cart.items, shippingAddress, shippingTotalsBySeller);

    // 4. Generate generic Payment Intent
    const paymentIntent = await this.prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        provider: 'GENERIC_PROVIDER',
        amount: order.totalAmount,
        currency: order.currency,
        status: 'PENDING'
      }
    });

    // 5. Deactivate Cart
    await this.prisma.cart.update({
      where: { id: cartId },
      data: { status: 'CHECKED_OUT' }
    });

    this.logger.log(`Checkout completed for Cart ${cartId}. Order ${order.id} generated.`);

    return {
      order,
      paymentIntent,
      message: 'Checkout successful. Awaiting payment.',
    };
  }

  private async resolveBuyerId(buyer: { buyerId?: string; email?: string; name?: string }): Promise<string | undefined> {
    if (buyer.buyerId) return buyer.buyerId;
    if (!buyer.email) return undefined;

    const user = await this.prisma.user.upsert({
      where: { email: buyer.email },
      update: buyer.name ? { name: buyer.name } : {},
      create: { email: buyer.email, name: buyer.name, role: 'BUYER' },
    });
    return user.id;
  }

  async confirmPayment(
    paymentIntentId: string,
    body: { status: 'SUCCEEDED' | 'FAILED'; externalId?: string },
    webhookSecret?: string,
  ) {
    const expectedSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!expectedSecret) throw new ServiceUnavailableException('Payment webhook is not configured');
    if (!webhookSecret || webhookSecret !== expectedSecret) throw new UnauthorizedException('Invalid payment webhook secret');
    if (!['SUCCEEDED', 'FAILED'].includes(body.status)) throw new BadRequestException('Unsupported payment status');

    const payment = await this.prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!payment) throw new BadRequestException('Payment intent not found');
    if (payment.status === 'SUCCEEDED') return payment;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentIntent.update({
        where: { id: payment.id },
        data: { status: body.status, externalId: body.externalId },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: body.status === 'SUCCEEDED' ? 'PAID' : 'PAYMENT_FAILED' },
      });
      if (body.status === 'SUCCEEDED') {
        await tx.sellerOrder.updateMany({
          where: { parentOrderId: payment.orderId, status: 'AWAITING_PAYMENT' },
          data: { status: 'PROCESSING' },
        });
      }
      return updated;
    });
  }
}
