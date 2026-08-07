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
import {
  TamaraService,
  type TamaraCheckoutItem,
  type TamaraCountryCode,
  type TamaraCurrency,
  type TamaraWebhookPayload,
} from './tamara.service';
import { PrismaService } from '../../prisma.service';
import {
  SETTLEMENT_CURRENCY,
  convertAmount,
  resolveChargeCurrency,
  roundMoney,
  type ChargeCurrency,
} from './currency.util';
import { EmailService } from '../email/email.service';
import { CheckoutIdentityService } from './checkout-identity.service';
import { normalizePhone } from '../auth/phone.util';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly buyerAppUrl: string;

  constructor(
    private cartService: CartService,
    private reservationService: ReservationService,
    private orderService: OrderService,
    private shippingService: ShippingService,
    private stripeService: StripeService,
    private tamaraService: TamaraService,
    private prisma: PrismaService,
    private emailService: EmailService,
    private checkoutIdentity: CheckoutIdentityService,
  ) {
    this.buyerAppUrl = process.env.BUYER_APP_URL || 'http://localhost:3000';
  }

  async processCheckout(
    cartId: string,
    buyer: {
      buyerId?: string;
      email?: string | null;
      name?: string;
      phone?: string;
    },
    shippingAddress: Record<string, unknown>,
    chargeCurrencyInput?: string | null,
    paymentProviderInput?: 'stripe' | 'tamara',
    checkoutAuth?: {
      checkoutSessionId?: string;
      checkoutToken?: string;
      idempotencyKey?: string;
    },
  ) {
    const normalizedBuyerPhone = normalizePhone(buyer.phone || '');
    let customerId: string;
    let resolvedBuyerId = buyer.buyerId;
    let checkoutSessionId: string | undefined;

    if (checkoutAuth?.checkoutSessionId) {
      const checkoutSession = await this.checkoutIdentity.authorize(
        checkoutAuth.checkoutSessionId,
        checkoutAuth.checkoutToken,
        cartId,
        true,
      );
      if (checkoutSession.phoneNormalized !== normalizedBuyerPhone) {
        throw new UnauthorizedException(
          'The checkout phone number changed. Verify the new number to continue.',
        );
      }
      customerId = checkoutSession.customerId!;
      checkoutSessionId = checkoutSession.id;
      const linkedAccount = await this.prisma.user.findUnique({
        where: { customerId },
      });
      resolvedBuyerId = linkedAccount?.id ?? resolvedBuyerId;
    } else if (buyer.buyerId) {
      const authenticatedUser = await this.prisma.user.findUnique({
        where: { id: buyer.buyerId },
      });
      if (
        !authenticatedUser?.phoneVerified ||
        !authenticatedUser.phone ||
        authenticatedUser.phone !== normalizedBuyerPhone
      ) {
        throw new UnauthorizedException('Verify this phone number to continue');
      }
      const customer = authenticatedUser.customerId
        ? await this.prisma.customer.update({
            where: { id: authenticatedUser.customerId },
            data: { phoneVerifiedAt: new Date() },
          })
        : await this.prisma.customer.upsert({
            where: { phoneNormalized: normalizedBuyerPhone },
            update: { phoneVerifiedAt: new Date() },
            create: {
              phoneNormalized: normalizedBuyerPhone,
              phoneVerifiedAt: new Date(),
              name: authenticatedUser.name,
              email: authenticatedUser.email,
            },
          });
      if (!authenticatedUser.customerId) {
        await this.prisma.user.update({
          where: { id: authenticatedUser.id },
          data: { customerId: customer.id },
        });
      }
      customerId = customer.id;
    } else {
      throw new UnauthorizedException('Verify your phone to continue');
    }

    const idempotencyKey =
      checkoutAuth?.idempotencyKey?.trim() ||
      (checkoutSessionId ? `checkout:${checkoutSessionId}` : undefined);
    if (!idempotencyKey) {
      throw new BadRequestException('Missing checkout idempotency key');
    }

    const existingOrder = await this.prisma.order.findFirst({
      where: checkoutSessionId
        ? { OR: [{ idempotencyKey }, { checkoutSessionId }] }
        : { idempotencyKey },
      include: {
        sellerOrders: { include: { items: true } },
        paymentIntent: {
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        },
      },
    });
    if (existingOrder) {
      if (existingOrder.customerId !== customerId) {
        throw new UnauthorizedException(
          'Checkout identity does not match this order',
        );
      }
      if (
        existingOrder.status === 'PAYMENT_FAILED' &&
        existingOrder.paymentIntent
      ) {
        return this.retryExistingOrderPayment(
          existingOrder,
          cartId,
          buyer,
          paymentProviderInput || existingOrder.paymentIntent.provider,
          checkoutSessionId,
        );
      }
      return this.resumeExistingOrder(existingOrder);
    }
    const paymentProvider = paymentProviderInput || 'stripe';
    if (paymentProvider === 'stripe' && !this.stripeService.isConfigured()) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY (sandbox) on the API.',
      );
    }
    if (paymentProvider === 'tamara' && !this.tamaraService.isConfigured()) {
      throw new ServiceUnavailableException(
        'Tamara is not configured. Set TAMARA_API_TOKEN on the API.',
      );
    }

    const cart = await this.cartService.getCart(cartId);

    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const destinationCountry = this.getDestinationCountry(shippingAddress);
    const tamaraMarket =
      paymentProvider === 'tamara'
        ? this.resolveTamaraMarket(destinationCountry)
        : null;
    const chargeCurrency = tamaraMarket
      ? tamaraMarket.currency
      : resolveChargeCurrency(chargeCurrencyInput);
    if (paymentProvider === 'tamara' && !buyer.phone?.trim()) {
      throw new BadRequestException('Phone number is required for Tamara');
    }

    const dbUser = resolvedBuyerId
      ? await this.prisma.user.findUnique({ where: { id: resolvedBuyerId } })
      : null;

    // Keep profile in sync with shipping contact details when provided
    if (buyer.name) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { name: buyer.name },
      });
      if (dbUser && buyer.name !== dbUser.name) {
        await this.prisma.user.update({
          where: { id: dbUser.id },
          data: { name: buyer.name },
        });
      }
    }
    if (buyer.email) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { email: buyer.email.trim().toLowerCase() },
      });
    }

    for (const item of cart.items) {
      const available = item.sellerOffer.inventory.reduce(
        (sum, inventory) => sum + inventory.quantity,
        0,
      );
      if (
        item.sellerOffer.status !== 'ACTIVE' ||
        item.sellerOffer.seller.onboardingStatus !== 'ACTIVE'
      ) {
        throw new BadRequestException(
          'One of the items in your cart is no longer available.',
        );
      }
      if (available < item.quantity) {
        throw new BadRequestException(
          `Only ${available} unit${available === 1 ? '' : 's'} remain for ${item.sellerOffer.canonicalPart?.title || 'an item in your cart'}.`,
        );
      }
    }

    // Validate shipping before reserving stock: a reservation held by a failed
    // checkout blocks the offer until its Redis TTL expires.
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
          .join(
            ', ',
          )}) and needs a freight quote. Please submit a freight quote request at ${this.buyerAppUrl}/support?category=FREIGHT_QUOTE.`,
      );
    }

    // 1. Lock stock for all items
    const reservedOffers: string[] = [];
    for (const item of cart.items) {
      const locked = await this.reservationService.reserveStock(
        cartId,
        item.sellerOfferId,
        item.quantity,
        item.sellerOffer.inventory.reduce(
          (sum, inventory) => sum + inventory.quantity,
          0,
        ),
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
      name: buyer.name,
      email: buyer.email,
      phone: normalizedBuyerPhone,
      chargeCurrency,
      settlementCurrency: SETTLEMENT_CURRENCY,
    };

    // 3. Create Multi-Seller Order in the buyer charge currency
    let order;
    try {
      order = await this.orderService.createMultiSellerOrder(
        resolvedBuyerId,
        pricedItems,
        orderAddress,
        shippingTotalsBySeller,
        chargeCurrency,
        {
          customerId,
          checkoutSessionId,
          verifiedPhone: normalizedBuyerPhone,
          idempotencyKey,
        },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const replay = await this.prisma.order.findFirst({
          where: checkoutSessionId
            ? { OR: [{ idempotencyKey }, { checkoutSessionId }] }
            : { idempotencyKey },
          include: {
            sellerOrders: { include: { items: true } },
            paymentIntent: {
              include: { attempts: { orderBy: { createdAt: 'desc' } } },
            },
          },
        });
        if (replay) return this.resumeExistingOrder(replay);
      }
      throw error;
    }

    // 4. Create the local payment record and the selected hosted checkout.
    const paymentIntent = await this.prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        provider: paymentProvider,
        amount: order.totalAmount,
        currency: order.currency,
        status: 'PENDING',
      },
    });
    const paymentAttempt = await this.prisma.paymentAttempt.create({
      data: {
        paymentIntentId: paymentIntent.id,
        provider: paymentProvider,
      },
    });

    const buyerAppUrl = (
      process.env.BUYER_APP_URL || 'http://localhost:3000'
    ).replace(/\/$/, '');

    let checkoutSession: { externalId: string; url: string | null };
    try {
      if (paymentProvider === 'tamara' && tamaraMarket) {
        const customerName = this.splitCustomerName(
          buyer.name || dbUser?.name || 'PartsBazar Customer',
        );
        const session = await this.tamaraService.createCheckoutSession({
          orderId: order.id,
          amount: order.totalAmount,
          shippingAmount: roundMoney(
            Object.values(shippingTotalsBySeller).reduce(
              (sum, amount) => sum + amount,
              0,
            ),
          ),
          currency: tamaraMarket.currency,
          countryCode: tamaraMarket.countryCode,
          customer: {
            // Tamara requires an email; phone-only guests don't have one, so
            // fall back to a placeholder tied to their verified phone number.
            email:
              buyer.email ||
              dbUser?.email ||
              `${normalizedBuyerPhone.replace(/[^a-zA-Z0-9]/g, '')}@guest.partsbazar360.com`,
            firstName: customerName.firstName,
            lastName: customerName.lastName,
            phoneNumber: buyer.phone!.trim(),
          },
          shippingAddress: {
            line1: this.addressField(shippingAddress, 'line1', true)!,
            line2: this.addressField(shippingAddress, 'line2'),
            city: this.addressField(shippingAddress, 'city', true)!,
            region: this.addressField(shippingAddress, 'region'),
          },
          items: this.toTamaraItems(pricedItems),
          successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&provider=tamara${checkoutSessionId ? `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}` : ''}`,
          failureUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&provider=tamara&reason=failed`,
          cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&provider=tamara`,
        });
        checkoutSession = {
          externalId: session.order_id,
          url: session.checkout_url,
        };
      } else {
        // Single total line ensures Stripe's amount exactly includes shipping.
        const session = await this.stripeService.createCheckoutSession({
          paymentIntentId: paymentIntent.id,
          orderId: order.id,
          amount: order.totalAmount,
          currency: order.currency,
          customerEmail: buyer.email || dbUser?.email || undefined,
          lineItems: [
            {
              name: `PartsBazar360 order (${cart.items.length} item${cart.items.length === 1 ? '' : 's'})`,
              quantity: 1,
              unitAmount: order.totalAmount,
            },
          ],
          successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&session_id={CHECKOUT_SESSION_ID}${checkoutSessionId ? `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}` : ''}`,
          cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&provider=stripe`,
        });
        checkoutSession = { externalId: session.id, url: session.url };
      }
    } catch (err) {
      this.logger.error(
        `${paymentProvider} checkout session failed for order ${order.id}`,
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
      await this.prisma.paymentAttempt.update({
        where: { id: paymentAttempt.id },
        data: { status: 'FAILED', failureCode: 'provider_session_failed' },
      });
      for (const reservedOfferId of reservedOffers) {
        await this.reservationService.releaseStock(cartId, reservedOfferId);
      }
      if (checkoutSessionId) {
        await this.checkoutIdentity.trackEvent(
          checkoutSessionId,
          'payment_failed',
          { reason: 'provider_session_failed', provider: paymentProvider },
        );
      }
      throw new ServiceUnavailableException(
        `Unable to start ${paymentProvider === 'tamara' ? 'Tamara' : 'Stripe'} checkout. Please try again.`,
      );
    }

    await this.prisma.paymentIntent.update({
      where: { id: paymentIntent.id },
      data: { externalId: checkoutSession.externalId },
    });
    await this.prisma.paymentAttempt.update({
      where: { id: paymentAttempt.id },
      data: {
        externalId: checkoutSession.externalId,
        checkoutUrl: checkoutSession.url,
      },
    });

    // The cart remains active until the payment webhook succeeds. This keeps
    // every item available for a decline/cancel/retry without re-entry.
    if (checkoutSessionId) {
      await this.prisma.checkoutSession.update({
        where: { id: checkoutSessionId },
        data: { status: 'ORDERED' },
      });
      await this.checkoutIdentity.trackEvent(
        checkoutSessionId,
        'payment_started',
        { provider: paymentProvider },
      );
    }

    this.logger.log(
      `Checkout completed for Cart ${cartId}. Order ${order.id} charged in ${chargeCurrency} via ${paymentProvider} ${checkoutSession.externalId}`,
    );

    return {
      order,
      paymentIntent: {
        ...paymentIntent,
        externalId: checkoutSession.externalId,
        status: 'PENDING',
      },
      checkoutUrl: checkoutSession.url,
      paymentProvider,
      chargeCurrency,
      settlementCurrency: SETTLEMENT_CURRENCY,
      message: `Redirect to ${paymentProvider === 'tamara' ? 'Tamara' : 'Stripe'} to complete payment in ${chargeCurrency}.`,
    };
  }

  private resumeExistingOrder(order: any) {
    const latestAttempt = order.paymentIntent?.attempts?.[0];
    return {
      order,
      paymentIntent: order.paymentIntent,
      checkoutUrl:
        order.status === 'PAID' ? null : (latestAttempt?.checkoutUrl ?? null),
      paymentProvider: order.paymentIntent?.provider ?? null,
      chargeCurrency: order.currency,
      settlementCurrency: SETTLEMENT_CURRENCY,
      idempotentReplay: true,
      message:
        order.status === 'PAID'
          ? 'This order is already paid.'
          : 'This checkout attempt already exists.',
    };
  }

  private async retryExistingOrderPayment(
    order: any,
    cartId: string,
    buyer: { email?: string | null; name?: string; phone?: string },
    providerInput: string,
    checkoutSessionId?: string,
  ) {
    const paymentProvider: 'stripe' | 'tamara' =
      providerInput === 'tamara' ? 'tamara' : 'stripe';
    if (paymentProvider === 'stripe' && !this.stripeService.isConfigured()) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY (sandbox) on the API.',
      );
    }
    if (paymentProvider === 'tamara' && !this.tamaraService.isConfigured()) {
      throw new ServiceUnavailableException(
        'Tamara is not configured. Set TAMARA_API_TOKEN on the API.',
      );
    }

    const cart = await this.cartService.getCart(cartId);
    const orderedQuantityByOffer = new Map<string, number>();
    for (const sellerOrder of order.sellerOrders) {
      for (const item of sellerOrder.items) {
        orderedQuantityByOffer.set(
          item.sellerOfferId,
          (orderedQuantityByOffer.get(item.sellerOfferId) ?? 0) + item.quantity,
        );
      }
    }
    const cartQuantityByOffer = new Map<string, number>();
    for (const item of cart.items) {
      cartQuantityByOffer.set(
        item.sellerOfferId,
        (cartQuantityByOffer.get(item.sellerOfferId) ?? 0) + item.quantity,
      );
    }
    const cartStillMatchesOrder =
      orderedQuantityByOffer.size === cartQuantityByOffer.size &&
      [...orderedQuantityByOffer].every(
        ([offerId, quantity]) => cartQuantityByOffer.get(offerId) === quantity,
      );
    if (!cartStillMatchesOrder) {
      throw new BadRequestException(
        'Your cart changed after this payment started. Restore the original items before retrying this order.',
      );
    }

    const reservedOffers: string[] = [];
    for (const [offerId, quantity] of orderedQuantityByOffer) {
      const cartItem = cart.items.find(
        (candidate) => candidate.sellerOfferId === offerId,
      );
      const available =
        cartItem?.sellerOffer.inventory.reduce(
          (sum: number, inventory: { quantity: number }) =>
            sum + inventory.quantity,
          0,
        ) ?? 0;
      const locked = await this.reservationService.reserveStock(
        cartId,
        offerId,
        quantity,
        available,
      );
      if (!locked) {
        for (const reservedOfferId of reservedOffers) {
          await this.reservationService.releaseStock(cartId, reservedOfferId);
        }
        throw new BadRequestException(
          'One of these items is no longer available in the requested quantity.',
        );
      }
      reservedOffers.push(offerId);
    }

    const address = (order.shippingAddress || {}) as Record<string, unknown>;
    const destinationCountry = this.getDestinationCountry(address);
    const tamaraMarket =
      paymentProvider === 'tamara'
        ? this.resolveTamaraMarket(destinationCountry)
        : null;
    const paymentClaim = await this.prisma.paymentIntent.updateMany({
      where: {
        id: order.paymentIntent.id,
        status: { not: 'SUCCEEDED' },
      },
      data: { provider: paymentProvider, status: 'PENDING', externalId: null },
    });
    if (paymentClaim.count === 0) {
      for (const reservedOfferId of reservedOffers) {
        await this.reservationService.releaseStock(cartId, reservedOfferId);
      }
      const paidOrder = await this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          sellerOrders: { include: { items: true } },
          paymentIntent: {
            include: { attempts: { orderBy: { createdAt: 'desc' } } },
          },
        },
      });
      return this.resumeExistingOrder(paidOrder);
    }
    const paymentIntent = await this.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: order.paymentIntent.id },
    });
    const attempt = await this.prisma.paymentAttempt.create({
      data: { paymentIntentId: paymentIntent.id, provider: paymentProvider },
    });
    const buyerAppUrl = this.buyerAppUrl.replace(/\/$/, '');
    let externalId: string;
    let checkoutUrl: string | null;

    try {
      if (paymentProvider === 'tamara' && tamaraMarket) {
        const customerName = this.splitCustomerName(
          buyer.name || String(address.name || 'PartsBazar Customer'),
        );
        const orderItems = order.sellerOrders.flatMap((sellerOrder: any) =>
          sellerOrder.items.map((item: any) => {
            const cartItem = cart.items.find(
              (candidate) => candidate.sellerOfferId === item.sellerOfferId,
            );
            return {
              quantity: item.quantity,
              sellerOfferId: item.sellerOfferId,
              sellerOffer: {
                ...(cartItem?.sellerOffer || {}),
                price: item.unitPrice,
              },
            };
          }),
        );
        const session = await this.tamaraService.createCheckoutSession({
          orderId: order.id,
          amount: order.totalAmount,
          shippingAmount: roundMoney(
            order.sellerOrders.reduce(
              (sum: number, sellerOrder: any) =>
                sum + sellerOrder.shippingTotal,
              0,
            ),
          ),
          currency: tamaraMarket.currency,
          countryCode: tamaraMarket.countryCode,
          customer: {
            email:
              buyer.email ||
              String(
                address.email ||
                  `${order.verifiedPhone?.replace(/\D/g, '')}@guest.partsbazar360.com`,
              ),
            firstName: customerName.firstName,
            lastName: customerName.lastName,
            phoneNumber: order.verifiedPhone,
          },
          shippingAddress: {
            line1: this.addressField(address, 'line1', true)!,
            line2: this.addressField(address, 'line2'),
            city: this.addressField(address, 'city', true)!,
            region: this.addressField(address, 'region'),
          },
          items: this.toTamaraItems(orderItems),
          successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&provider=tamara${checkoutSessionId ? `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}` : ''}`,
          failureUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&provider=tamara&reason=failed`,
          cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&provider=tamara`,
        });
        externalId = session.order_id;
        checkoutUrl = session.checkout_url;
      } else {
        const session = await this.stripeService.createCheckoutSession({
          paymentIntentId: paymentIntent.id,
          orderId: order.id,
          amount: order.totalAmount,
          currency: order.currency,
          customerEmail: buyer.email || undefined,
          lineItems: [
            {
              name: `PartsBazar360 order (${cart.items.length} item${cart.items.length === 1 ? '' : 's'})`,
              quantity: 1,
              unitAmount: order.totalAmount,
            },
          ],
          successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&session_id={CHECKOUT_SESSION_ID}${checkoutSessionId ? `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}` : ''}`,
          cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&provider=stripe`,
        });
        externalId = session.id;
        checkoutUrl = session.url;
      }
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.paymentIntent.update({
          where: { id: paymentIntent.id },
          data: { status: 'FAILED' },
        }),
        this.prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', failureCode: 'provider_session_failed' },
        }),
      ]);
      for (const reservedOfferId of reservedOffers) {
        await this.reservationService.releaseStock(cartId, reservedOfferId);
      }
      if (checkoutSessionId) {
        await this.checkoutIdentity.trackEvent(
          checkoutSessionId,
          'payment_failed',
          { reason: 'provider_session_failed', provider: paymentProvider },
        );
      }
      throw new ServiceUnavailableException(
        `Unable to start ${paymentProvider === 'tamara' ? 'Tamara' : 'Stripe'} checkout. Please try again.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.paymentIntent.updateMany({
        where: { id: paymentIntent.id, status: { not: 'SUCCEEDED' } },
        data: { externalId },
      }),
      this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { externalId, checkoutUrl },
      }),
      this.prisma.order.updateMany({
        where: { id: order.id, status: { not: 'PAID' } },
        data: { status: 'PENDING_PAYMENT' },
      }),
    ]);
    const finalPayment = await this.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: paymentIntent.id },
    });
    if (finalPayment.status === 'SUCCEEDED') {
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          failureCode: 'order_already_paid',
        },
      });
      return {
        order: { ...order, status: 'PAID' },
        paymentIntent: finalPayment,
        checkoutUrl: null,
        paymentProvider: finalPayment.provider,
        chargeCurrency: order.currency,
        settlementCurrency: SETTLEMENT_CURRENCY,
        idempotentReplay: true,
        message: 'This order is already paid.',
      };
    }
    if (checkoutSessionId) {
      await this.checkoutIdentity.trackEvent(
        checkoutSessionId,
        'payment_started',
        {
          provider: paymentProvider,
          retry: true,
        },
      );
    }
    return {
      order: { ...order, status: 'PENDING_PAYMENT' },
      paymentIntent: { ...paymentIntent, externalId },
      checkoutUrl,
      paymentProvider,
      chargeCurrency: order.currency,
      settlementCurrency: SETTLEMENT_CURRENCY,
      retried: true,
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
    const sellerQuotes = Object.entries(itemsBySeller).map(
      ([sellerId, items]) => {
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
            items[0]?.sellerOffer.seller?.name || 'Marketplace seller',
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
          ...quote,
          currency: chargeCurrency,
          amount,
          amountAed: quote.amount,
        };
      },
    );

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

  async handleTamaraWebhook(
    body: TamaraWebhookPayload,
    token: string | undefined,
  ) {
    this.tamaraService.verifyWebhookToken(token);
    if (!body?.order_id || !body.order_reference_id || !body.event_type) {
      throw new BadRequestException('Invalid Tamara webhook payload');
    }

    const payment = await this.prisma.paymentIntent.findFirst({
      where: {
        orderId: body.order_reference_id,
        provider: 'tamara',
      },
    });
    if (!payment) {
      throw new BadRequestException('Tamara payment not found');
    }
    if (payment.externalId && payment.externalId !== body.order_id) {
      const knownAttempt = await this.prisma.paymentAttempt.findUnique({
        where: { externalId: body.order_id },
      });
      if (!knownAttempt || knownAttempt.paymentIntentId !== payment.id) {
        throw new UnauthorizedException('Tamara order does not match payment');
      }
    }

    if (body.event_type === 'order_approved') {
      if (payment.status !== 'SUCCEEDED') {
        await this.tamaraService.authoriseOrder(body.order_id);
        await this.applyPaymentStatus(payment.id, 'SUCCEEDED', body.order_id);
      }
      return { received: true };
    }

    if (
      body.event_type === 'order_authorised' ||
      body.event_type === 'order_captured'
    ) {
      await this.applyPaymentStatus(payment.id, 'SUCCEEDED', body.order_id);
      return { received: true };
    }

    if (
      body.event_type === 'order_declined' ||
      body.event_type === 'order_expired' ||
      body.event_type === 'order_canceled'
    ) {
      await this.applyPaymentStatus(payment.id, 'FAILED', body.order_id);
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
      include: {
        order: {
          include: {
            sellerOrders: { include: { items: true } },
            checkoutSession: { select: { cartId: true } },
          },
        },
      },
    });
    if (!payment) throw new BadRequestException('Payment intent not found');
    if (payment.status === 'SUCCEEDED') return payment;
    if (
      status === 'FAILED' &&
      externalId &&
      payment.externalId &&
      payment.externalId !== externalId
    ) {
      await this.prisma.paymentAttempt.updateMany({
        where: { paymentIntentId: payment.id, externalId },
        data: { status: 'FAILED', failureCode: 'provider_declined' },
      });
      return payment;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentIntent.updateMany({
        where: { id: payment.id, status: { not: 'SUCCEEDED' } },
        data: {
          status,
          ...(externalId ? { externalId } : {}),
        },
      });
      if (claimed.count === 0) {
        return tx.paymentIntent.findUniqueOrThrow({
          where: { id: payment.id },
        });
      }
      const current = await tx.paymentIntent.findUniqueOrThrow({
        where: { id: payment.id },
      });
      if (externalId) {
        await tx.paymentAttempt.updateMany({
          where: { paymentIntentId: payment.id, externalId },
          data: {
            status,
            ...(status === 'FAILED'
              ? { failureCode: 'provider_declined' }
              : {}),
          },
        });
      }
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: status === 'SUCCEEDED' ? 'PAID' : 'PAYMENT_FAILED' },
      });
      if (status === 'SUCCEEDED') {
        const quantityByOffer = new Map<string, number>();
        for (const sellerOrder of payment.order.sellerOrders) {
          for (const item of sellerOrder.items) {
            quantityByOffer.set(
              item.sellerOfferId,
              (quantityByOffer.get(item.sellerOfferId) ?? 0) + item.quantity,
            );
          }
        }
        for (const [offerId, requiredQuantity] of quantityByOffer) {
          let remaining = requiredQuantity;
          const inventoryRows = await tx.inventory.findMany({
            where: { offerId, quantity: { gt: 0 } },
            orderBy: { updatedAt: 'asc' },
          });
          for (const inventory of inventoryRows) {
            if (remaining <= 0) break;
            const decrement = Math.min(remaining, inventory.quantity);
            const result = await tx.inventory.updateMany({
              where: { id: inventory.id, quantity: { gte: decrement } },
              data: { quantity: { decrement } },
            });
            if (result.count === 1) remaining -= decrement;
          }
          if (remaining > 0) {
            throw new ServiceUnavailableException(
              `Inventory changed while payment was processing for offer ${offerId}`,
            );
          }
        }
        await tx.sellerOrder.updateMany({
          where: { parentOrderId: payment.orderId, status: 'AWAITING_PAYMENT' },
          data: { status: 'PROCESSING' },
        });
        if (payment.order.checkoutSession?.cartId) {
          const account = payment.order.customerId
            ? await tx.user.findUnique({
                where: { customerId: payment.order.customerId },
                select: { id: true },
              })
            : null;
          await tx.cart.update({
            where: { id: payment.order.checkoutSession.cartId },
            data: {
              status: 'CHECKED_OUT',
              sessionId: null,
              userId: account?.id,
            },
          });
        }
      }
      return current;
    });

    if (status === 'SUCCEEDED') {
      if (payment.order.checkoutSession?.cartId) {
        for (const sellerOrder of payment.order.sellerOrders) {
          for (const item of sellerOrder.items) {
            await this.reservationService
              .releaseStock(
                payment.order.checkoutSession.cartId,
                item.sellerOfferId,
              )
              .catch(() => undefined);
          }
        }
      }
      void this.sendOrderConfirmationEmail(payment.orderId).catch((err) =>
        this.logger.error(`Order confirmation email failed: ${err}`),
      );
      void this.sendAdminOrderNotification(payment.orderId).catch((err) =>
        this.logger.error(`Order admin notification failed: ${err}`),
      );
      if (payment.order.checkoutSessionId) {
        await this.checkoutIdentity.trackEvent(
          payment.order.checkoutSessionId,
          'order_completed',
          { provider: payment.provider },
        );
      }
    } else {
      if (payment.order.checkoutSession?.cartId) {
        for (const sellerOrder of payment.order.sellerOrders) {
          for (const item of sellerOrder.items) {
            await this.reservationService
              .releaseStock(
                payment.order.checkoutSession.cartId,
                item.sellerOfferId,
              )
              .catch(() => undefined);
          }
        }
      }
      if (payment.order.checkoutSessionId) {
        await this.checkoutIdentity.trackEvent(
          payment.order.checkoutSessionId,
          'payment_failed',
          { provider: payment.provider },
        );
      }
    }
    return updated;
  }

  async listCustomerOrders(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.customerId) return [];
    return this.prisma.order.findMany({
      where: { customerId: user.customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        sellerOrders: {
          include: {
            items: {
              include: {
                sellerOffer: {
                  include: { canonicalPart: true, seller: true },
                },
              },
            },
          },
        },
        paymentIntent: true,
      },
    });
  }

  async getCustomerOrder(
    orderId: string,
    access: {
      userId?: string;
      checkoutSessionId?: string;
      checkoutToken?: string;
    },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        sellerOrders: {
          include: {
            items: {
              include: {
                sellerOffer: {
                  include: { canonicalPart: true, seller: true },
                },
              },
            },
          },
        },
        paymentIntent: true,
      },
    });
    if (!order) throw new BadRequestException('Order not found');

    let authorized = false;
    if (access.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: access.userId },
      });
      authorized = Boolean(
        user?.customerId && user.customerId === order.customerId,
      );
    }
    if (!authorized && access.checkoutSessionId === order.checkoutSessionId) {
      await this.checkoutIdentity.authorize(
        access.checkoutSessionId!,
        access.checkoutToken,
        undefined,
        true,
      );
      authorized = true;
    }
    if (!authorized) throw new UnauthorizedException('Order access denied');
    return order;
  }

  private async sendAdminOrderNotification(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        sellerOrders: { include: { seller: true, items: true } },
      },
    });
    if (!order?.buyerId) return;

    const user = await this.prisma.user.findUnique({
      where: { id: order.buyerId },
    });
    if (!user?.email) return;

    const sellerCount = new Set(order.sellerOrders.map((so) => so.sellerId))
      .size;
    const itemCount = order.sellerOrders.reduce(
      (sum, so) => sum + so.items.reduce((s, i) => s + i.quantity, 0),
      0,
    );

    this.emailService.sendNewOrderAdminNotification({
      orderId: order.id,
      totalAmount: order.totalAmount,
      currency: order.currency,
      buyerEmail: user.email,
      itemCount,
      sellerCount,
    });
  }

  private async sendOrderConfirmationEmail(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        sellerOrders: {
          include: {
            items: {
              include: {
                sellerOffer: {
                  include: { canonicalPart: { select: { title: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!order?.buyerId) return;

    const user = await this.prisma.user.findUnique({
      where: { id: order.buyerId },
    });
    if (!user?.email) return;

    const items = order.sellerOrders.flatMap((so) =>
      so.items.map((item) => ({
        name:
          item.sellerOffer.canonicalPart?.title ||
          `Part ${item.sellerOfferId.slice(0, 8)}`,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    );

    const address = order.shippingAddress as Record<string, string> | null;
    const shippingStr = address
      ? [address.line1, address.city, address.state, address.country]
          .filter(Boolean)
          .join(', ')
      : undefined;

    await this.emailService.sendOrderConfirmation(user.email, {
      orderId: order.id,
      totalAmount: order.totalAmount,
      currency: order.currency,
      items,
      shippingAddress: shippingStr,
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

  private resolveTamaraMarket(destinationCountry: string): {
    countryCode: TamaraCountryCode;
    currency: TamaraCurrency;
  } {
    const normalized = destinationCountry
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    if (
      normalized === 'ae' ||
      normalized === 'uae' ||
      normalized === 'unitedarabemirates'
    ) {
      return { countryCode: 'AE', currency: 'AED' };
    }
    if (
      normalized === 'sa' ||
      normalized === 'ksa' ||
      normalized === 'saudiarabia'
    ) {
      return { countryCode: 'SA', currency: 'SAR' };
    }
    throw new BadRequestException(
      'Tamara is currently available for UAE and Saudi Arabia deliveries only',
    );
  }

  private splitCustomerName(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift() || 'Customer';
    return {
      firstName,
      lastName: parts.join(' ') || firstName,
    };
  }

  private addressField(
    address: Record<string, unknown>,
    field: string,
    required = false,
  ): string | undefined {
    const value =
      typeof address[field] === 'string' ? address[field].trim() : '';
    if (!value && required) {
      throw new BadRequestException(`Shipping ${field} is required`);
    }
    return value || undefined;
  }

  private toTamaraItems(items: any[]): TamaraCheckoutItem[] {
    return items.map((item) => {
      const unitAmount = roundMoney(Number(item.sellerOffer.price));
      return {
        referenceId: String(item.sellerOfferId),
        name:
          item.sellerOffer.canonicalPart?.title ||
          item.sellerOffer.sellerTitle ||
          'Auto part',
        sku:
          item.sellerOffer.sellerSku ||
          item.sellerOffer.externalOfferId ||
          item.sellerOfferId,
        quantity: Number(item.quantity),
        unitAmount,
        totalAmount: roundMoney(unitAmount * Number(item.quantity)),
      };
    });
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
