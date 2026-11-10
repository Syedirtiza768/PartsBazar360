import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isBuyerVerifiedFitmentEvidence } from '@repo/catalog-contracts';
import { CartService } from '../cart/cart.service';
import { ReservationService } from '../inventory/reservation.service';
import { OrderService } from '../order/order.service';
import {
  partRequiresSpecialHandling,
  ShippingService,
  type ShippingQuoteItem,
} from './shipping.service';
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
import { CheckoutIdentityService } from './checkout-identity.service';
import { OrderNotificationService } from '../order/order-notification.service';
import { normalizePhone, normalizeUnvalidatedPhone } from '../auth/phone.util';
import { buildPurchaseTrackingPayload } from './purchase-tracking.util';
import {
  acknowledgmentsMatch,
  CHECKOUT_VALIDATION_POLICY_VERSION,
  CHECKOUT_VALIDATION_TTL_MS,
  checkoutValidationFingerprint,
  publicCheckoutValidation,
  type CheckoutLineDecision,
} from './checkout-validation.util';

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
    private orderNotifications: OrderNotificationService,
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
      validationId?: string;
      acknowledgedCartItemIds?: string[];
    },
    couponCodeInput?: string | null,
  ) {
    const normalizedBuyerPhone =
      process.env.CHECKOUT_OTP_BYPASS === '1' &&
      Boolean(checkoutAuth?.checkoutSessionId)
        ? normalizeUnvalidatedPhone(buyer.phone || '')
        : normalizePhone(buyer.phone || '');
    let customerId: string;
    let resolvedBuyerId = buyer.buyerId;
    let checkoutSessionId: string | undefined;

    if (checkoutAuth?.checkoutSessionId) {
      const checkoutSession = await this.checkoutIdentity.authorize(
        checkoutAuth.checkoutSessionId,
        checkoutAuth.checkoutToken,
        cartId,
        true,
        normalizedBuyerPhone,
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
          {
            validationId: checkoutAuth?.validationId,
            acknowledgedCartItemIds: checkoutAuth?.acknowledgedCartItemIds,
          },
        );
      }
      if (existingOrder.status !== 'PAID') {
        await this.validatePendingOrderResume({
          order: existingOrder,
          cartId,
          shippingAddress,
          chargeCurrencyInput,
          paymentProviderInput,
          checkoutSessionId,
          validationInput: {
            validationId: checkoutAuth?.validationId,
            acknowledgedCartItemIds: checkoutAuth?.acknowledgedCartItemIds,
          },
        });
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

    const coupon = couponCodeInput?.trim()
      ? await this.resolveCouponForItems(
          cart.items,
          couponCodeInput,
          chargeCurrency,
        )
      : null;

    const checkoutValidation = await this.requireCheckoutValidation({
      cart,
      cartId,
      checkoutSessionId,
      validationId: checkoutAuth?.validationId,
      acknowledgedCartItemIds: checkoutAuth?.acknowledgedCartItemIds,
      shippingAddress,
      destinationCountry,
      chargeCurrency,
      paymentProvider,
      couponCode: coupon?.code ?? null,
    });

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
    this.assertShippingQuotesAvailable(
      [...quotesBySeller.values()],
      destinationCountry,
    );

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
          couponId: coupon?.id,
          couponCode: coupon?.code,
          discountAmount: coupon?.discountAmount,
          cartId,
          checkoutValidationId: checkoutValidation.id,
          checkoutValidationSnapshot: checkoutValidation.snapshot,
          shippingQuoteSnapshotsBySeller: Object.fromEntries(
            [...quotesBySeller.entries()].map(([sellerId, quote]) => [
              sellerId,
              quote,
            ]),
          ),
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
        if (replay) {
          const replayFingerprint = (
            replay.checkoutValidationSnapshot as
              Record<string, unknown> | null | undefined
          )?.fingerprint;
          if (
            typeof replayFingerprint !== 'string' ||
            replayFingerprint !== checkoutValidation.snapshot.fingerprint
          ) {
            throw new ConflictException(
              'Another checkout attempt created an order with different reviewed details. Review the order again before paying.',
            );
          }
          return this.resumeExistingOrder(replay);
        }
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
          items: this.toTamaraItems(pricedItems, coupon?.discountAmount),
          successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&provider=tamara${checkoutSessionId ? `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}` : ''}`,
          failureUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&provider=tamara&reason=failed`,
          cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&provider=tamara`,
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
          successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&session_id={CHECKOUT_SESSION_ID}${checkoutSessionId ? `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}` : ''}`,
          cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&provider=stripe`,
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
      void this.orderNotifications
        .notifyOrderUpdated(order.id, {
          type: 'PAYMENT_STATUS_CHANGED',
          previousStatus: order.status,
          status: 'PAYMENT_FAILED',
        })
        .catch((notificationError) =>
          this.logger.error(
            `Payment failure notification failed: ${notificationError}`,
          ),
        );
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
      order: this.toBuyerOrder(order, cart.items),
      paymentIntent: this.toBuyerPaymentIntent({
        ...paymentIntent,
        status: 'PENDING',
      }),
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
      order: this.toBuyerOrder(order),
      paymentIntent: this.toBuyerPaymentIntent(order.paymentIntent),
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
    validationInput?: {
      validationId?: string;
      acknowledgedCartItemIds?: string[];
    },
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

    const address = (order.shippingAddress || {}) as Record<string, unknown>;
    const destinationCountry = this.getDestinationCountry(address);
    const checkoutValidation = await this.requireCheckoutValidation({
      cart,
      cartId,
      checkoutSessionId,
      validationId: validationInput?.validationId,
      acknowledgedCartItemIds: validationInput?.acknowledgedCartItemIds,
      shippingAddress: address,
      destinationCountry,
      chargeCurrency: order.currency as ChargeCurrency,
      paymentProvider,
      couponCode: order.couponCode ?? null,
    });
    const retryQuotes = Object.values(this.groupItemsBySeller(cart.items)).map(
      (items) =>
        this.shippingService.quoteSellerShipping(
          items.map((item) => this.toShippingItem(item)),
          destinationCountry,
        ),
    );
    this.assertShippingQuotesAvailable(retryQuotes, destinationCountry);

    const retryQuoteBySeller = Object.fromEntries(
      Object.entries(this.groupItemsBySeller(cart.items)).map(
        ([sellerId, sellerItems]) => [
          sellerId,
          this.shippingService.quoteSellerShipping(
            sellerItems.map((item) => this.toShippingItem(item)),
            destinationCountry,
          ),
        ],
      ),
    );
    for (const sellerOrder of order.sellerOrders) {
      const quote = retryQuoteBySeller[sellerOrder.sellerId];
      const recalculatedShipping = quote
        ? convertAmount(quote.amount, SETTLEMENT_CURRENCY, order.currency)
        : null;
      if (
        recalculatedShipping == null ||
        roundMoney(recalculatedShipping) !==
          roundMoney(sellerOrder.shippingTotal)
      ) {
        throw new ConflictException(
          'Delivery pricing changed since this order was created. Contact support before retrying payment.',
        );
      }
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

    const tamaraMarket =
      paymentProvider === 'tamara'
        ? this.resolveTamaraMarket(destinationCountry)
        : null;
    const paymentClaim = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.paymentIntent.updateMany({
        where: {
          id: order.paymentIntent.id,
          status: { not: 'SUCCEEDED' },
        },
        data: {
          provider: paymentProvider,
          status: 'PENDING',
          externalId: null,
        },
      });
      if (claim.count === 0) return claim;

      const validationClaim = await tx.checkoutValidation.updateMany({
        where: {
          id: checkoutValidation.id,
          cartId,
          checkoutSessionId: checkoutSessionId ?? null,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (validationClaim.count !== 1) {
        throw new ConflictException(
          'Checkout review expired or was already used. Review the order again.',
        );
      }
      return claim;
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
      data: {
        paymentIntentId: paymentIntent.id,
        provider: paymentProvider,
        validationSnapshot: checkoutValidation.snapshot,
      },
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
          items: this.toTamaraItems(orderItems, order.discountAmount),
          successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&provider=tamara${checkoutSessionId ? `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}` : ''}`,
          failureUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&provider=tamara&reason=failed`,
          cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&provider=tamara`,
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
          successUrl: `${buyerAppUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&session_id={CHECKOUT_SESSION_ID}${checkoutSessionId ? `&checkoutSessionId=${encodeURIComponent(checkoutSessionId)}` : ''}`,
          cancelUrl: `${buyerAppUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}&displayOrderNumber=${encodeURIComponent(order.orderNumber || order.id)}&provider=stripe`,
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

    const [, , pendingOrderUpdate] = await this.prisma.$transaction([
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
    if (pendingOrderUpdate.count === 1 && order.status !== 'PENDING_PAYMENT') {
      void this.orderNotifications
        .notifyOrderUpdated(order.id, {
          type: 'PAYMENT_STATUS_CHANGED',
          previousStatus: order.status,
          status: 'PENDING_PAYMENT',
        })
        .catch((err) =>
          this.logger.error(`Payment retry notification failed: ${err}`),
        );
    }
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
        order: this.toBuyerOrder({ ...order, status: 'PAID' }, cart.items),
        paymentIntent: this.toBuyerPaymentIntent(finalPayment),
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
      order: this.toBuyerOrder(
        { ...order, status: 'PENDING_PAYMENT' },
        cart.items,
      ),
      paymentIntent: this.toBuyerPaymentIntent({
        ...paymentIntent,
        status: 'PENDING',
      }),
      checkoutUrl,
      paymentProvider,
      chargeCurrency: order.currency,
      settlementCurrency: SETTLEMENT_CURRENCY,
      retried: true,
    };
  }

  async quoteCoupon(
    cartId: string,
    code: string,
    chargeCurrencyInput?: string | null,
  ) {
    const cart = await this.cartService.getCart(cartId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }
    const chargeCurrency = resolveChargeCurrency(chargeCurrencyInput);
    const coupon = await this.resolveCouponForItems(
      cart.items,
      code,
      chargeCurrency,
    );
    return {
      code: coupon.code,
      discountPercent: coupon.discountPercent,
      currency: chargeCurrency,
      subtotal: coupon.subtotal,
      discountAmount: coupon.discountAmount,
      discountedSubtotal: roundMoney(coupon.subtotal - coupon.discountAmount),
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
    const sellerQuotes = Object.entries(itemsBySeller)
      .sort(([sellerA], [sellerB]) => sellerA.localeCompare(sellerB))
      .map(([_sellerId, items], index) => {
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
          shipmentNumber: index + 1,
          shipmentLabel: `Shipment ${index + 1}`,
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
    const available = sellerQuotes.every((quote) => quote.available);
    const shippingTotal = available
      ? roundMoney(sellerQuotes.reduce((sum, quote) => sum + quote.amount, 0))
      : null;

    return {
      currency: chargeCurrency,
      settlementCurrency: SETTLEMENT_CURRENCY,
      destinationCountry: country,
      available,
      subtotal: roundMoney(subtotal),
      shippingTotal,
      totalAmount:
        shippingTotal == null ? null : roundMoney(subtotal + shippingTotal),
      sellerQuotes,
    };
  }

  async validateCheckout(
    cartId: string,
    shippingAddress: Record<string, unknown>,
    chargeCurrencyInput?: string | null,
    paymentProviderInput?: 'stripe' | 'tamara',
    couponCodeInput?: string | null,
    checkoutAuth?: {
      checkoutSessionId?: string;
      checkoutToken?: string;
    },
  ) {
    const checkoutSession = checkoutAuth?.checkoutSessionId
      ? await this.checkoutIdentity.authorize(
          checkoutAuth.checkoutSessionId,
          checkoutAuth.checkoutToken,
          cartId,
          true,
        )
      : null;
    const cart = await this.cartService.getCart(cartId);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const destinationCountry = this.getDestinationCountry(shippingAddress);
    const paymentProvider = paymentProviderInput || 'stripe';
    const tamaraMarket =
      paymentProvider === 'tamara'
        ? this.resolveTamaraMarket(destinationCountry)
        : null;
    const chargeCurrency = tamaraMarket
      ? tamaraMarket.currency
      : resolveChargeCurrency(chargeCurrencyInput);
    const coupon = couponCodeInput?.trim()
      ? await this.resolveCouponForItems(
          cart.items,
          couponCodeInput,
          chargeCurrency,
        )
      : null;
    const evaluation = await this.evaluateCheckoutCart({
      cart,
      shippingAddress,
      destinationCountry,
      chargeCurrency,
      paymentProvider,
      couponCode: coupon?.code ?? null,
    });
    const validationId = randomUUID();
    const expiresAt = new Date(Date.now() + CHECKOUT_VALIDATION_TTL_MS);
    const snapshot = {
      ...evaluation.snapshot,
      validationId,
      fingerprint: evaluation.fingerprint,
      expiresAt: expiresAt.toISOString(),
    };

    await this.prisma.checkoutValidation.create({
      data: {
        id: validationId,
        cartId,
        checkoutSessionId: checkoutSession?.id ?? null,
        fingerprint: evaluation.fingerprint,
        snapshot: snapshot as any,
        expiresAt,
      },
    });

    return publicCheckoutValidation(snapshot);
  }

  private async evaluateCheckoutCart(input: {
    cart: any;
    shippingAddress: Record<string, unknown>;
    destinationCountry: string;
    chargeCurrency: ChargeCurrency;
    paymentProvider: 'stripe' | 'tamara';
    couponCode: string | null;
  }) {
    const items = [...input.cart.items].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const coupon = input.couponCode
      ? await this.resolveCouponForItems(
          items,
          input.couponCode,
          input.chargeCurrency,
        )
      : null;
    const fitmentPairs = items
      .filter((item) => item.intendedVehicleConfigId)
      .map((item) => ({
        canonicalPartId: item.sellerOffer.canonicalPartId,
        vehicleConfigId: item.intendedVehicleConfigId,
      }));
    const fitments = fitmentPairs.length
      ? await this.prisma.fitment.findMany({
          where: {
            OR: fitmentPairs.map((pair) => ({
              canonicalPartId: pair.canonicalPartId,
              vehicleConfigId: pair.vehicleConfigId,
            })),
          },
          select: {
            id: true,
            canonicalPartId: true,
            vehicleConfigId: true,
            evidenceLevel: true,
            confidence: true,
            source: true,
            verificationStatus: true,
            updatedAt: true,
          },
        })
      : [];
    const fitmentByPair = new Map(
      fitments.map((fitment) => [
        `${fitment.canonicalPartId}:${fitment.vehicleConfigId}`,
        fitment,
      ]),
    );

    const itemsBySeller = this.groupItemsBySeller(items);
    const sellerQuotes = Object.entries(itemsBySeller)
      .sort(([sellerA], [sellerB]) => sellerA.localeCompare(sellerB))
      .map(([sellerId, sellerItems]) => ({
        sellerId,
        itemIds: sellerItems.map((item) => item.id).sort(),
        quote: this.shippingService.quoteSellerShipping(
          sellerItems.map((item) => this.toShippingItem(item)),
          input.destinationCountry,
        ),
      }));
    const quoteBySeller = new Map(
      sellerQuotes.map((entry) => [entry.sellerId, entry.quote]),
    );
    const shippingAvailable = sellerQuotes.every(
      (entry) => entry.quote.available,
    );

    const lines: CheckoutLineDecision[] = items.map((item) => {
      const part = item.sellerOffer.canonicalPart;
      const fitment = item.intendedVehicleConfigId
        ? fitmentByPair.get(
            `${item.sellerOffer.canonicalPartId}:${item.intendedVehicleConfigId}`,
          )
        : null;
      const fitmentStatus: CheckoutLineDecision['fitmentStatus'] =
        !item.intendedVehicleConfigId
          ? 'NO_VEHICLE'
          : fitment?.verificationStatus === 'CONFLICT'
            ? 'CONFLICT'
            : fitment &&
                isBuyerVerifiedFitmentEvidence(
                  fitment.evidenceLevel,
                  Number(fitment.confidence),
                  fitment.source,
                )
              ? 'CONFIRMED'
              : 'UNVERIFIED';
      const quote = quoteBySeller.get(item.sellerOffer.sellerId);
      const shippingStatus: CheckoutLineDecision['shippingStatus'] =
        quote?.requiresFreightQuote
          ? 'REQUIRES_QUOTE'
          : quote?.availabilityReason === 'SPECIAL_HANDLING_REVIEW'
            ? 'NEEDS_REVIEW'
            : quote?.available
              ? 'AVAILABLE'
              : 'BLOCKED';
      const availableStock = item.sellerOffer.inventory.reduce(
        (sum: number, inventory: { quantity: number }) =>
          sum + inventory.quantity,
        0,
      );
      let blockingReason: string | null = null;
      if (fitmentStatus === 'CONFLICT') blockingReason = 'FITMENT_CONFLICT';
      else if (
        item.sellerOffer.status !== 'ACTIVE' ||
        item.sellerOffer.seller.onboardingStatus !== 'ACTIVE'
      ) {
        blockingReason = 'ITEM_UNAVAILABLE';
      } else if (availableStock < item.quantity) {
        blockingReason = 'INSUFFICIENT_STOCK';
      } else if (shippingStatus !== 'AVAILABLE') {
        blockingReason = shippingStatus;
      }

      return {
        cartItemId: item.id,
        partId: part?.id ?? item.sellerOffer.canonicalPartId,
        offerId: item.sellerOfferId,
        quantity: item.quantity,
        intendedVehicleConfigId: item.intendedVehicleConfigId ?? null,
        purchaseIntent: item.purchaseIntent || 'UNSPECIFIED',
        fitmentStatus,
        fitmentId: fitment?.id ?? null,
        evidenceLevel: fitment?.evidenceLevel ?? null,
        confidence: fitment ? Number(fitment.confidence) : null,
        source: fitment?.source ?? null,
        verificationStatus: fitment?.verificationStatus ?? null,
        shippingStatus,
        shippingReason: quote?.availabilityReason ?? null,
        blockingReason,
        partUpdatedAt: part?.updatedAt?.toISOString?.() ?? null,
        offerUpdatedAt: item.sellerOffer.updatedAt?.toISOString?.() ?? null,
        fitmentUpdatedAt: fitment?.updatedAt?.toISOString?.() ?? null,
        unitPrice: Number(item.sellerOffer.price),
        currency: item.sellerOffer.currency,
        condition: item.sellerOffer.condition,
        availableStock,
      } as CheckoutLineDecision & Record<string, unknown>;
    });

    const requiredAcknowledgmentCartItemIds = lines
      .filter(
        (line) =>
          line.fitmentStatus === 'NO_VEHICLE' ||
          line.fitmentStatus === 'UNVERIFIED',
      )
      .map((line) => line.cartItemId)
      .sort();
    const blockingLineIds = lines
      .filter((line) => line.blockingReason)
      .map((line) => line.cartItemId)
      .sort();
    const shippingQuotes = sellerQuotes.map(({ sellerId, itemIds, quote }) => ({
      sellerId,
      itemIds,
      destinationCountry: quote.destinationCountry,
      available: quote.available,
      availabilityReason: quote.availabilityReason,
      requiresFreightQuote: quote.requiresFreightQuote,
      serviceType: quote.serviceType,
      leadTime: quote.leadTime,
      billableWeightGrams: quote.billableWeightGrams,
      amountAed: quote.amount,
      weightBasis: quote.weightBasis,
      weightSource: quote.weightSource,
      estimated: quote.estimated,
      marginPct: quote.marginPct,
    }));
    const addressFingerprint = {
      country: input.destinationCountry.trim().toLowerCase(),
      line1: String(input.shippingAddress.line1 ?? '')
        .trim()
        .toLowerCase(),
      line2: String(input.shippingAddress.line2 ?? '')
        .trim()
        .toLowerCase(),
      city: String(input.shippingAddress.city ?? '')
        .trim()
        .toLowerCase(),
      region: String(input.shippingAddress.region ?? '')
        .trim()
        .toLowerCase(),
      postalCode: String(input.shippingAddress.postalCode ?? '')
        .trim()
        .toLowerCase(),
    };
    const fingerprint = checkoutValidationFingerprint({
      policyVersion: CHECKOUT_VALIDATION_POLICY_VERSION,
      cartId: input.cart.id,
      address: addressFingerprint,
      chargeCurrency: input.chargeCurrency,
      paymentProvider: input.paymentProvider,
      coupon: coupon
        ? {
            id: coupon.id,
            code: coupon.code,
            discountPercent: coupon.discountPercent,
            subtotal: coupon.subtotal,
            discountAmount: coupon.discountAmount,
          }
        : null,
      lines,
      shippingQuotes,
    });
    return {
      fingerprint,
      snapshot: {
        cartId: input.cart.id,
        policyVersion: CHECKOUT_VALIDATION_POLICY_VERSION,
        destinationCountry: input.destinationCountry,
        chargeCurrency: input.chargeCurrency,
        paymentProvider: input.paymentProvider,
        couponCode: input.couponCode,
        coupon,
        addressFingerprint,
        evaluatedAt: new Date().toISOString(),
        shippingAvailable,
        lines,
        shippingQuotes,
        requiredAcknowledgmentCartItemIds,
        blockingLineIds,
      },
    };
  }

  private async requireCheckoutValidation(input: {
    cart: any;
    cartId: string;
    checkoutSessionId?: string;
    validationId?: string;
    acknowledgedCartItemIds?: string[];
    shippingAddress: Record<string, unknown>;
    destinationCountry: string;
    chargeCurrency: ChargeCurrency;
    paymentProvider: 'stripe' | 'tamara';
    couponCode: string | null;
  }) {
    if (!input.validationId) {
      throw new BadRequestException(
        'Review this cart before paying so each item can be validated.',
      );
    }
    const validation = await this.prisma.checkoutValidation.findFirst({
      where: {
        id: input.validationId,
        cartId: input.cartId,
        checkoutSessionId: input.checkoutSessionId ?? null,
      },
    });
    if (
      !validation ||
      validation.consumedAt ||
      validation.expiresAt <= new Date()
    ) {
      throw new ConflictException(
        'Checkout review expired. Review your delivery and items again.',
      );
    }

    const current = await this.evaluateCheckoutCart({
      cart: input.cart,
      shippingAddress: input.shippingAddress,
      destinationCountry: input.destinationCountry,
      chargeCurrency: input.chargeCurrency,
      paymentProvider: input.paymentProvider,
      couponCode: input.couponCode,
    });
    if (current.fingerprint !== validation.fingerprint) {
      throw new ConflictException(
        'Your cart, fitment, price, or delivery rules changed. Review the order again.',
      );
    }
    const snapshot = validation.snapshot as any;
    if (snapshot.blockingLineIds?.length) {
      const blockingLines = (snapshot.lines || []).filter(
        (line: CheckoutLineDecision) =>
          snapshot.blockingLineIds.includes(line.cartItemId),
      );
      if (
        blockingLines.some(
          (line: CheckoutLineDecision) => line.fitmentStatus === 'CONFLICT',
        )
      ) {
        throw new BadRequestException(
          'A cart item conflicts with its selected vehicle. Remove it or choose a different vehicle before paying.',
        );
      }
      if (
        blockingLines.some(
          (line: CheckoutLineDecision) =>
            line.shippingStatus === 'REQUIRES_QUOTE',
        )
      ) {
        throw new BadRequestException(
          'One or more items exceed courier limits and need a freight quote before payment.',
        );
      }
      if (
        blockingLines.some(
          (line: CheckoutLineDecision) =>
            line.shippingStatus === 'NEEDS_REVIEW',
        )
      ) {
        throw new BadRequestException(
          'One or more items need a specialist shipping review before payment.',
        );
      }
      throw new BadRequestException(
        blockingLines.some(
          (line: CheckoutLineDecision) => line.shippingStatus === 'BLOCKED',
        )
          ? 'One or more items do not have a supported delivery service for this destination.'
          : 'One or more cart items cannot be purchased with the current stock or delivery selection.',
      );
    }
    const acknowledgedCartItemIds = input.acknowledgedCartItemIds ?? [];
    if (
      !acknowledgmentsMatch(
        snapshot.requiredAcknowledgmentCartItemIds ?? [],
        acknowledgedCartItemIds,
      )
    ) {
      throw new BadRequestException(
        'Review and acknowledge each item whose fitment is not confirmed.',
      );
    }

    const acknowledged = new Set(acknowledgedCartItemIds);
    return {
      id: validation.id,
      snapshot: {
        ...snapshot,
        acknowledgedCartItemIds,
        lines: snapshot.lines.map((line: CheckoutLineDecision) => ({
          ...line,
          purchaseIntent: acknowledged.has(line.cartItemId)
            ? 'EXACT_NUMBER_OR_INTENDED_USE'
            : line.purchaseIntent,
          acknowledged: acknowledged.has(line.cartItemId),
          acknowledgedAt: acknowledged.has(line.cartItemId)
            ? new Date().toISOString()
            : null,
        })),
      },
    };
  }

  private async validatePendingOrderResume(input: {
    order: any;
    cartId: string;
    shippingAddress: Record<string, unknown>;
    chargeCurrencyInput?: string | null;
    paymentProviderInput?: 'stripe' | 'tamara';
    checkoutSessionId?: string;
    validationInput?: {
      validationId?: string;
      acknowledgedCartItemIds?: string[];
    };
  }) {
    const { order } = input;
    if (
      order.status !== 'PENDING_PAYMENT' ||
      !order.paymentIntent ||
      order.paymentIntent.status !== 'PENDING'
    ) {
      throw new ConflictException(
        'This order is no longer waiting for payment. Refresh your order status before continuing.',
      );
    }

    const address = (order.shippingAddress || {}) as Record<string, unknown>;
    const addressFields = [
      'country',
      'line1',
      'line2',
      'city',
      'region',
      'postalCode',
    ];
    const normalizeAddressValue = (value: unknown) =>
      String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    if (
      addressFields.some(
        (field) =>
          normalizeAddressValue(address[field]) !==
          normalizeAddressValue(input.shippingAddress[field]),
      )
    ) {
      throw new ConflictException(
        'The delivery address for this payment has changed. Start a new checkout review.',
      );
    }

    const paymentProvider =
      input.paymentProviderInput || order.paymentIntent.provider;
    if (paymentProvider !== order.paymentIntent.provider) {
      throw new ConflictException(
        'This order already has a payment session with a different provider. Start a new checkout review.',
      );
    }
    const chargeCurrency = input.chargeCurrencyInput
      ? resolveChargeCurrency(input.chargeCurrencyInput)
      : (order.currency as ChargeCurrency);
    if (chargeCurrency !== order.currency) {
      throw new ConflictException(
        'The payment currency for this order has changed. Start a new checkout review.',
      );
    }

    const cart = await this.cartService.getCart(input.cartId);
    const orderLines = (order.sellerOrders || []).flatMap((sellerOrder: any) =>
      (sellerOrder.items || []).map((item: any) => ({
        sellerOfferId: item.sellerOfferId,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      })),
    );
    const cartLines = cart.items.map((item: any) => ({
      sellerOfferId: item.sellerOfferId,
      quantity: Number(item.quantity),
      unitPrice: convertAmount(
        Number(item.sellerOffer.price),
        item.sellerOffer.currency,
        chargeCurrency,
      ),
    }));
    const orderedByOffer = new Map<
      string,
      { quantity: number; unitPrice: number }
    >();
    for (const line of orderLines) {
      const current = orderedByOffer.get(line.sellerOfferId);
      if (
        current &&
        roundMoney(current.unitPrice) !== roundMoney(line.unitPrice)
      ) {
        throw new ConflictException(
          'The item price on this order no longer matches the cart. Review checkout again.',
        );
      }
      orderedByOffer.set(line.sellerOfferId, {
        quantity: (current?.quantity ?? 0) + line.quantity,
        unitPrice: line.unitPrice,
      });
    }
    const cartByOffer = new Map<
      string,
      { quantity: number; unitPrice: number }
    >();
    for (const line of cartLines) {
      const current = cartByOffer.get(line.sellerOfferId);
      if (
        current &&
        roundMoney(current.unitPrice) !== roundMoney(line.unitPrice)
      ) {
        throw new ConflictException(
          'The item price on this order no longer matches the cart. Review checkout again.',
        );
      }
      cartByOffer.set(line.sellerOfferId, {
        quantity: (current?.quantity ?? 0) + line.quantity,
        unitPrice: line.unitPrice,
      });
    }
    if (
      orderedByOffer.size !== cartByOffer.size ||
      [...orderedByOffer].some(([offerId, line]) => {
        const current = cartByOffer.get(offerId);
        return (
          !current ||
          current.quantity !== line.quantity ||
          roundMoney(current.unitPrice) !== roundMoney(line.unitPrice)
        );
      })
    ) {
      throw new ConflictException(
        'The cart no longer matches this payment order. Restore the original items or start a new checkout.',
      );
    }

    const destinationCountry = this.getDestinationCountry(
      input.shippingAddress,
    );
    const validation = await this.requireCheckoutValidation({
      cart,
      cartId: input.cartId,
      checkoutSessionId: input.checkoutSessionId,
      validationId: input.validationInput?.validationId,
      acknowledgedCartItemIds: input.validationInput?.acknowledgedCartItemIds,
      shippingAddress: input.shippingAddress,
      destinationCountry,
      chargeCurrency,
      paymentProvider,
      couponCode: order.couponCode ?? null,
    });
    const originalFingerprint = (
      order.checkoutValidationSnapshot as Record<string, unknown> | null
    )?.fingerprint;
    if (
      typeof originalFingerprint === 'string' &&
      originalFingerprint !== validation.snapshot.fingerprint
    ) {
      throw new ConflictException(
        'Fitment, delivery, or checkout policy changed since this payment order was created. Review a new order before paying.',
      );
    }

    const snapshotQuotes = (validation.snapshot.shippingQuotes || []) as Array<{
      sellerId: string;
      amountAed: number;
    }>;
    const quoteBySeller = new Map(
      snapshotQuotes.map((quote) => [quote.sellerId, quote]),
    );
    for (const sellerOrder of order.sellerOrders || []) {
      const quote = quoteBySeller.get(sellerOrder.sellerId);
      const expectedShipping = quote
        ? convertAmount(quote.amountAed, SETTLEMENT_CURRENCY, chargeCurrency)
        : null;
      if (
        expectedShipping == null ||
        roundMoney(expectedShipping) !== roundMoney(sellerOrder.shippingTotal)
      ) {
        throw new ConflictException(
          'Delivery pricing changed since this order was created. Review checkout again before paying.',
        );
      }
    }
    const expectedTotal = roundMoney(
      cartLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) +
        order.sellerOrders.reduce(
          (sum: number, sellerOrder: any) =>
            sum + Number(sellerOrder.shippingTotal),
          0,
        ) -
        Number(order.discountAmount || 0),
    );
    if (expectedTotal !== roundMoney(Number(order.totalAmount))) {
      throw new ConflictException(
        'The payable total no longer matches the reviewed cart. Review checkout again before paying.',
      );
    }

    const claim = await this.prisma.checkoutValidation.updateMany({
      where: {
        id: validation.id,
        cartId: input.cartId,
        checkoutSessionId: input.checkoutSessionId ?? null,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new ConflictException(
        'Checkout review expired or was already used. Review the order again.',
      );
    }
  }

  private assertShippingQuotesAvailable(
    quotes: Array<ReturnType<ShippingService['quoteSellerShipping']>>,
    destinationCountry: string,
  ) {
    const freightQuotes = quotes.filter((quote) => quote.requiresFreightQuote);
    if (freightQuotes.length > 0) {
      throw new BadRequestException(
        `This order exceeds courier limits (${freightQuotes
          .map((quote) => `${quote.quotedWeightKg}kg+`)
          .join(
            ', ',
          )}) and needs a freight quote. Please submit a freight quote request at ${this.buyerAppUrl}/support?category=FREIGHT_QUOTE.`,
      );
    }

    if (quotes.some((quote) => !quote.available)) {
      if (
        quotes.some(
          (quote) => quote.availabilityReason === 'SPECIAL_HANDLING_REVIEW',
        )
      ) {
        throw new BadRequestException(
          'One or more items need a specialist shipping review. Request a shipping quote before paying.',
        );
      }
      throw new BadRequestException(
        `We don't currently have a confirmed shipping service to ${destinationCountry}. Choose another delivery country or request a shipping quote through ${this.buyerAppUrl}/support.`,
      );
    }
  }

  private async resolveCouponForItems(
    items: any[],
    codeInput: string,
    chargeCurrency: ChargeCurrency,
  ) {
    const code = codeInput.trim().toUpperCase();
    if (!code || code.length > 64) {
      throw new BadRequestException('Enter a valid coupon code');
    }

    const coupon = await this.prisma.discountCoupon.findUnique({
      where: { code },
    });
    const now = new Date();
    if (
      !coupon ||
      !coupon.active ||
      (coupon.startsAt && coupon.startsAt > now) ||
      (coupon.endsAt && coupon.endsAt <= now) ||
      coupon.discountPercent <= 0 ||
      coupon.discountPercent > 100
    ) {
      throw new BadRequestException('This coupon code is invalid or expired');
    }

    const subtotal = roundMoney(
      items.reduce(
        (sum, item) =>
          sum +
          item.quantity *
            convertAmount(
              item.sellerOffer.price,
              item.sellerOffer.currency,
              chargeCurrency,
            ),
        0,
      ),
    );
    const discountAmount = roundMoney(
      Math.min(subtotal, (subtotal * coupon.discountPercent) / 100),
    );

    return {
      id: coupon.id,
      code: coupon.code,
      discountPercent: coupon.discountPercent,
      subtotal,
      discountAmount,
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

    const previousOrderStatus = payment.order.status;

    let paymentStatusClaimed = false;
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
      paymentStatusClaimed = true;
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

    if (status === 'SUCCEEDED' && paymentStatusClaimed) {
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
      void this.orderNotifications
        .notifyOrderUpdated(payment.orderId, {
          type: 'PAYMENT_STATUS_CHANGED',
          previousStatus: previousOrderStatus,
          status: 'PAID',
        })
        .catch((err) =>
          this.logger.error(`Order payment notification failed: ${err}`),
        );
      if (payment.order.checkoutSessionId) {
        await this.checkoutIdentity.trackEvent(
          payment.order.checkoutSessionId,
          'order_completed',
          { provider: payment.provider },
        );
      }
    } else {
      if (status === 'FAILED' && paymentStatusClaimed) {
        void this.orderNotifications
          .notifyOrderUpdated(payment.orderId, {
            type: 'PAYMENT_STATUS_CHANGED',
            previousStatus: previousOrderStatus,
            status: 'PAYMENT_FAILED',
          })
          .catch((err) =>
            this.logger.error(
              `Order payment failure notification failed: ${err}`,
            ),
          );
      }
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
    const orders = await this.prisma.order.findMany({
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
    return orders.map((order) => this.toBuyerOrder(order));
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
    return {
      ...this.toBuyerOrder(order),
      ecommerce: buildPurchaseTrackingPayload(order),
    };
  }

  private toBuyerPaymentIntent(paymentIntent: any) {
    if (!paymentIntent) return null;
    return {
      status: paymentIntent.status,
      provider: paymentIntent.provider,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      createdAt: paymentIntent.createdAt,
      updatedAt: paymentIntent.updatedAt,
    };
  }

  /** Strip seller ids, payout data, offer ids, and supplier relations from buyer order reads. */
  private toBuyerOrder(order: any, cartItems?: any[]) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      status: order.status,
      totalAmount: order.totalAmount,
      discountAmount: order.discountAmount,
      couponCode: order.couponCode,
      currency: order.currency,
      shippingAddress: order.shippingAddress,
      sellerOrders: (order.sellerOrders || []).map(
        (sellerOrder: any, shipmentIndex: number) => ({
          id: `shipment-${shipmentIndex + 1}`,
          shipmentLabel: `Shipment ${shipmentIndex + 1}`,
          subTotal: sellerOrder.subTotal,
          discountTotal: sellerOrder.discountTotal,
          shippingTotal: sellerOrder.shippingTotal,
          status: sellerOrder.status,
          trackingNumber: sellerOrder.trackingNumber,
          carrier: sellerOrder.carrier,
          trackingUrl: sellerOrder.trackingUrl,
          createdAt: sellerOrder.createdAt,
          updatedAt: sellerOrder.updatedAt,
          items: (sellerOrder.items || []).map(
            (item: any, lineIndex: number) => {
              const cartItem = cartItems?.find(
                (candidate) => candidate.sellerOfferId === item.sellerOfferId,
              );
              const offer = item.sellerOffer || cartItem?.sellerOffer;
              const storedLine = item.lineSnapshot as
                Record<string, unknown> | null | undefined;
              const part = storedLine
                ? {
                    id: storedLine.partId,
                    slug: storedLine.slug,
                    title: storedLine.title,
                    imageUrls: storedLine.imageUrls,
                    brand: storedLine.brand,
                    partSource: storedLine.partSource,
                    partType: storedLine.partType,
                    oeNumbers: storedLine.oeNumbers,
                  }
                : offer?.canonicalPart;
              const price = Number(item.unitPrice ?? offer?.price ?? 0);
              const decision = item.decisionSnapshot as
                Record<string, unknown> | null | undefined;
              return {
                id: item.id || `line-${shipmentIndex + 1}-${lineIndex + 1}`,
                quantity: item.quantity,
                unitPrice: price,
                fitmentDecision: decision
                  ? {
                      status: decision.fitmentStatus,
                      intendedVehicleConfigId: decision.intendedVehicleConfigId,
                      acknowledged: decision.acknowledged === true,
                    }
                  : null,
                sellerOffer: {
                  id: item.id || `line-${shipmentIndex + 1}-${lineIndex + 1}`,
                  price,
                  currency: order.currency,
                  condition: storedLine?.condition ?? offer?.condition,
                  partSource: offer?.partSource,
                  partType: offer?.partType,
                  canonicalPart: part
                    ? {
                        id: part.id,
                        slug: part.slug,
                        title: part.title,
                        imageUrls: part.imageUrls,
                        brand: part.brand,
                        partSource: part.partSource,
                        partType: part.partType,
                      }
                    : null,
                },
              };
            },
          ),
        }),
      ),
      paymentIntent: this.toBuyerPaymentIntent(order.paymentIntent),
    };
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

  private toTamaraItems(
    items: any[],
    discountAmount = 0,
  ): TamaraCheckoutItem[] {
    const lineSubtotals = items.map((item) =>
      roundMoney(Number(item.sellerOffer.price) * Number(item.quantity)),
    );
    const subtotal = lineSubtotals.reduce((sum, value) => sum + value, 0);
    const appliedDiscount = Math.min(
      Math.max(0, roundMoney(discountAmount)),
      roundMoney(subtotal),
    );
    let allocatedDiscount = 0;

    return items.map((item, index) => {
      const unitAmount = roundMoney(Number(item.sellerOffer.price));
      const lineDiscount =
        index === items.length - 1
          ? roundMoney(appliedDiscount - allocatedDiscount)
          : roundMoney(
              subtotal > 0
                ? (appliedDiscount * lineSubtotals[index]) / subtotal
                : 0,
            );
      allocatedDiscount += lineDiscount;
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
        totalAmount: lineSubtotals[index],
        discountAmount: lineDiscount,
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
        id?: string | null;
        weight?: number | null;
        weightSource?: string | null;
        partClassKey?: string | null;
        dimensions?: unknown;
        title?: string | null;
        category?: string | null;
        itemSpecifics?: unknown;
      } | null;
    };
  }): ShippingQuoteItem {
    const part = item.sellerOffer.canonicalPart;
    return {
      quantity: item.quantity,
      canonicalPartId: part?.id ?? null,
      weightKg: part?.weight ?? null,
      weightSource: part?.weightSource ?? null,
      dimensionsCm: parseDimensionsJson(part?.dimensions),
      partClassKey:
        part?.partClassKey ??
        resolvePartClassKey({
          title: part?.title ?? null,
          category: part?.category ?? null,
        }),
      requiresSpecialHandling: partRequiresSpecialHandling(part?.itemSpecifics),
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
