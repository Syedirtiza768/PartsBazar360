import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CartService } from '../cart/cart.service';
import { ReservationService } from '../inventory/reservation.service';
import { OrderService } from '../order/order.service';
import { ShippingService, type ShippingQuoteItem } from './shipping.service';
import { parseDimensionsJson } from './billable-weight.util';
import { resolvePartClassKey } from './part-class-weights';
import { StripeService } from './stripe.service';
import { PrismaService } from '../../prisma.service';
import {
  SETTLEMENT_CURRENCY,
  convertAmount,
  resolveChargeCurrency,
  roundMoney,
  type ChargeCurrency,
} from './currency.util';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private cartService: CartService,
    private reservationService: ReservationService,
    private orderService: OrderService,
    private shippingService: ShippingService,
    private stripeService: StripeService,
    private prisma: PrismaService,
  ) {}

  async processCheckout(
    cartId: string,
    buyer: { buyerId: string; email: string; name?: string },
    shippingAddress: Record<string, unknown>,
    chargeCurrencyInput?: string | null,
  ) {
    if (!buyer.buyerId) {
      throw new UnauthorizedException('Sign in required to checkout');
    }
    if (!this.stripeService.isConfigured()) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY (sandbox) on the API.',
      );
    }

    const chargeCurrency = resolveChargeCurrency(chargeCurrencyInput);
    const cart = await this.cartService.getCart(cartId);

    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: buyer.buyerId },
    });
    if (!dbUser) {
      throw new UnauthorizedException('Buyer account not found');
    }

    // Keep profile in sync with shipping contact details when provided
    if (buyer.name && buyer.name !== dbUser.name) {
      await this.prisma.user.update({
        where: { id: buyer.buyerId },
        data: { name: buyer.name },
      });
    }

    // Validate shipping before reserving stock: a reservation held by a failed
    // checkout blocks the offer until its Redis TTL expires.
    const destinationCountry = this.getDestinationCountry(shippingAddress);
    const quotesBySeller = new Map(
      Object.entries(this.groupItemsBySeller(cart.items)).map(
        ([sellerId, items]) =>
          [
            sellerId,
            this.shippingService.quoteSellerShipping(
              items.map((i) => this.toShippingItem(i)),
              destinationCountry,
            ),
          ] as const,
      ),
    );

    const freightSellers = [...quotesBySeller.values()].filter(
      (quote) => quote.requiresFreightQuote,
    );
    if (freightSellers.length > 0) {
      // The rate sheet only covers courier parcels, so an automatic price here
      // would under-charge by a wide margin. Ops must quote these manually.
      throw new BadRequestException(
        `This order exceeds courier limits (${freightSellers
          .map((q) => `${q.quotedWeightKg}kg+`)
          .join(', ')}) and needs a freight quote. Please request a shipping quote for these items.`,
      );
    }

    // 1. Lock stock for all items
    const reservedOffers: string[] = [];
    for (const item of cart.items) {
      const locked = await this.reservationService.reserveStock(
        cartId,
        item.sellerOfferId,
        item.quantity,
      );
      if (!locked) {
        for (const reservedOfferId of reservedOffers) {
          await this.reservationService.releaseStock(cartId, reservedOfferId);
        }
        throw new BadRequestException(
          `Failed to reserve stock for offer ${item.sellerOfferId}. It might be sold out.`,
        );
      }
      reservedOffers.push(item.sellerOfferId);
    }

    const pricedItems = this.toChargeCurrencyItems(cart.items, chargeCurrency);

    const shippingTotalsBySeller: Record<string, number> = {};
    for (const [sellerId, quote] of quotesBySeller) {
      shippingTotalsBySeller[sellerId] = convertAmount(
        quote.amount,
        SETTLEMENT_CURRENCY,
        chargeCurrency,
      );
    }

    const orderAddress = {
      ...shippingAddress,
      chargeCurrency,
      settlementCurrency: SETTLEMENT_CURRENCY,
    };

    // 3. Create Multi-Seller Order in the buyer charge currency
    const order = await this.orderService.createMultiSellerOrder(
      buyer.buyerId,
      pricedItems,
      orderAddress,
      shippingTotalsBySeller,
      chargeCurrency,
    );

    // 4. Create local payment record + Stripe Checkout Session (hosted — card never hits our servers)
    const paymentIntent = await this.prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        provider: 'stripe',
        amount: order.totalAmount,
        currency: order.currency,
        status: 'PENDING',
      },
    });

    const buyerAppUrl = (
      process.env.BUYER_APP_URL || 'http://localhost:3000'
    ).replace(/\/$/, '');
    // Single line item for the order total (parts + shipping) so Stripe amount matches exactly.
    const lineItems = [
      {
        name: `PartsBazar360 order (${cart.items.length} item${cart.items.length === 1 ? '' : 's'})`,
        quantity: 1,
        unitAmount: order.totalAmount,
      },
    ];

    let checkoutSession;
    try {
      checkoutSession = await this.stripeService.createCheckoutSession({
        paymentIntentId: paymentIntent.id,
        orderId: order.id,
        amount: order.totalAmount,
        currency: order.currency,
        customerEmail: buyer.email || dbUser.email,
        lineItems,
        successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}`,
      });
    } catch (err) {
      this.logger.error(
        `Stripe Checkout Session failed for order ${order.id}`,
        err,
      );
      await this.prisma.paymentIntent.update({
        where: { id: paymentIntent.id },
        data: { status: 'FAILED' },
      });
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'PAYMENT_FAILED' },
      });
      throw new ServiceUnavailableException(
        'Unable to start Stripe Checkout. Check sandbox keys and try again.',
      );
    }

    await this.prisma.paymentIntent.update({
      where: { id: paymentIntent.id },
      data: { externalId: checkoutSession.id },
    });

    // 5. Deactivate Cart (clear sessionId so guest can start a fresh cart)
    await this.prisma.cart.update({
      where: { id: cartId },
      data: {
        status: 'CHECKED_OUT',
        userId: buyer.buyerId,
        sessionId: null,
      },
    });

    this.logger.log(
      `Checkout completed for Cart ${cartId}. Order ${order.id} charged in ${chargeCurrency} → Stripe ${checkoutSession.id}`,
    );

    return {
      order,
      paymentIntent: {
        ...paymentIntent,
        externalId: checkoutSession.id,
        status: 'PENDING',
      },
      checkoutUrl: checkoutSession.url,
      chargeCurrency,
      settlementCurrency: SETTLEMENT_CURRENCY,
      message: `Redirect to Stripe Checkout to complete payment in ${chargeCurrency}.`,
    };
  }

  async quoteShipping(
    cartId: string,
    destinationCountry: string,
    chargeCurrencyInput?: string | null,
  ) {
    const country = destinationCountry?.trim() ?? '';
    if (!country) {
      throw new BadRequestException('Shipping country is required');
    }

    const chargeCurrency = resolveChargeCurrency(chargeCurrencyInput);
    const cart = await this.cartService.getCart(cartId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const itemsBySeller = this.groupItemsBySeller(cart.items);
    const sellerQuotes = Object.entries(itemsBySeller).map(([sellerId, items]) => {
      const quote = this.shippingService.quoteSellerShipping(
        items.map((item) => this.toShippingItem(item)),
        country,
      );
      const amount = convertAmount(
        quote.amount,
        SETTLEMENT_CURRENCY,
        chargeCurrency,
      );

      return {
        sellerId,
        sellerName:
          items[0]?.sellerOffer.seller?.name ||
          'Marketplace seller',
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        ...quote,
        currency: chargeCurrency,
        amount,
        amountAed: quote.amount,
      };
    });

    const subtotal = cart.items.reduce(
      (sum, item) =>
        sum +
        item.quantity *
          convertAmount(
            item.sellerOffer.price,
            item.sellerOffer.currency,
            chargeCurrency,
          ),
      0,
    );
    const shippingTotal = roundMoney(
      sellerQuotes.reduce((sum, quote) => sum + quote.amount, 0),
    );

    return {
      currency: chargeCurrency,
      settlementCurrency: SETTLEMENT_CURRENCY,
      destinationCountry: country,
      subtotal: roundMoney(subtotal),
      shippingTotal,
      totalAmount: roundMoney(subtotal + shippingTotal),
      sellerQuotes,
    };
  }

  async confirmPayment(
    paymentIntentId: string,
    body: { status: 'SUCCEEDED' | 'FAILED'; externalId?: string },
    webhookSecret?: string,
  ) {
    const expectedSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!expectedSecret)
      throw new ServiceUnavailableException(
        'Payment webhook is not configured',
      );
    if (!webhookSecret || webhookSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid payment webhook secret');
    }
    if (!['SUCCEEDED', 'FAILED'].includes(body.status)) {
      throw new BadRequestException('Unsupported payment status');
    }

    return this.applyPaymentStatus(
      paymentIntentId,
      body.status,
      body.externalId,
    );
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!signature) {
      throw new UnauthorizedException('Missing Stripe signature');
    }

    let event;
    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature);
    } catch (err) {
      this.logger.warn(
        `Stripe webhook signature verification failed: ${String(err)}`,
      );
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        id: string;
        payment_status?: string;
        metadata?: { paymentIntentId?: string; orderId?: string };
      };
      const paymentIntentId = session.metadata?.paymentIntentId;
      if (!paymentIntentId) {
        this.logger.warn(
          `Stripe session ${session.id} missing paymentIntentId metadata`,
        );
        return { received: true, ignored: true };
      }
      if (session.payment_status && session.payment_status !== 'paid') {
        return { received: true, ignored: true };
      }
      await this.applyPaymentStatus(paymentIntentId, 'SUCCEEDED', session.id);
      return { received: true };
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as {
        id: string;
        metadata?: { paymentIntentId?: string };
      };
      const paymentIntentId = session.metadata?.paymentIntentId;
      if (paymentIntentId) {
        await this.applyPaymentStatus(paymentIntentId, 'FAILED', session.id);
      }
      return { received: true };
    }

    return { received: true, ignored: true };
  }

  private async applyPaymentStatus(
    paymentIntentId: string,
    status: 'SUCCEEDED' | 'FAILED',
    externalId?: string,
  ) {
    const payment = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
    });
    if (!payment) throw new BadRequestException('Payment intent not found');
    if (payment.status === 'SUCCEEDED') return payment;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentIntent.update({
        where: { id: payment.id },
        data: {
          status,
          ...(externalId ? { externalId } : {}),
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: status === 'SUCCEEDED' ? 'PAID' : 'PAYMENT_FAILED' },
      });
      if (status === 'SUCCEEDED') {
        await tx.sellerOrder.updateMany({
          where: { parentOrderId: payment.orderId, status: 'AWAITING_PAYMENT' },
          data: { status: 'PROCESSING' },
        });
      }
      return updated;
    });
  }

  private getDestinationCountry(shippingAddress: Record<string, unknown>) {
    const country =
      typeof shippingAddress.country === 'string'
        ? shippingAddress.country.trim()
        : '';
    if (!country) {
      throw new BadRequestException('Shipping country is required');
    }
    return country;
  }

  /**
   * Maps a cart line to the rate engine's input. Dimensions and part class come
   * from the catalog part so bulky-light items are billed on volume, and the
   * weight source is forwarded so estimates receive a safety margin.
   */
  private toShippingItem(item: {
    quantity: number;
    sellerOffer: {
      canonicalPart?: {
        weight?: number | null;
        weightSource?: string | null;
        partClassKey?: string | null;
        dimensions?: unknown;
        title?: string | null;
        category?: string | null;
      } | null;
    };
  }): ShippingQuoteItem {
    const part = item.sellerOffer.canonicalPart;
    return {
      quantity: item.quantity,
      weightKg: part?.weight ?? null,
      weightSource: part?.weightSource ?? null,
      dimensionsCm: parseDimensionsJson(part?.dimensions),
      partClassKey:
        part?.partClassKey ??
        resolvePartClassKey({
          title: part?.title ?? null,
          category: part?.category ?? null,
        }),
    };
  }

  private toChargeCurrencyItems<
    T extends {
      quantity: number;
      sellerOffer: {
        price: number;
        currency?: string | null;
        marketplaceFee?: number | null;
        sellerProceeds?: number | null;
        sellerBasePrice?: number | null;
      };
    },
  >(items: T[], chargeCurrency: ChargeCurrency) {
    return items.map((item) => {
      const from = item.sellerOffer.currency || SETTLEMENT_CURRENCY;
      return {
        ...item,
        sellerOffer: {
          ...item.sellerOffer,
          price: convertAmount(item.sellerOffer.price, from, chargeCurrency),
          marketplaceFee:
            item.sellerOffer.marketplaceFee == null
              ? item.sellerOffer.marketplaceFee
              : convertAmount(
                  item.sellerOffer.marketplaceFee,
                  from,
                  chargeCurrency,
                ),
          sellerProceeds:
            item.sellerOffer.sellerProceeds == null
              ? item.sellerOffer.sellerProceeds
              : convertAmount(
                  item.sellerOffer.sellerProceeds,
                  from,
                  chargeCurrency,
                ),
          sellerBasePrice:
            item.sellerOffer.sellerBasePrice == null
              ? item.sellerOffer.sellerBasePrice
              : convertAmount(
                  item.sellerOffer.sellerBasePrice,
                  from,
                  chargeCurrency,
                ),
          currency: chargeCurrency,
        },
      };
    });
  }

  private groupItemsBySeller<T extends { sellerOffer: { sellerId: string } }>(
    items: T[],
  ) {
    return items.reduce(
      (acc, item) => {
        const sellerId = item.sellerOffer.sellerId;
        if (!acc[sellerId]) acc[sellerId] = [];
        acc[sellerId].push(item);
        return acc;
      },
      {} as Record<string, T[]>,
    );
  }
}
