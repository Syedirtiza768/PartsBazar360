import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | null = null;

  private getClient(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY (sandbox) on the API.',
      );
    }
    if (!this.client) {
      this.client = new Stripe(key);
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  }

  /** Convert major units (e.g. 12.50 AED) to Stripe's smallest currency unit. */
  toStripeAmount(amount: number): number {
    return Math.round(amount * 100);
  }

  async createCheckoutSession(input: {
    paymentIntentId: string;
    orderId: string;
    amount: number;
    currency: string;
    customerEmail?: string;
    lineItems: Array<{ name: string; quantity: number; unitAmount: number }>;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = this.getClient();
    const currency = input.currency.toLowerCase();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
      client_reference_id: input.orderId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items:
        input.lineItems.length > 0
          ? input.lineItems.map((item) => ({
              quantity: item.quantity,
              price_data: {
                currency,
                unit_amount: this.toStripeAmount(item.unitAmount),
                product_data: { name: item.name.slice(0, 120) },
              },
            }))
          : [
              {
                quantity: 1,
                price_data: {
                  currency,
                  unit_amount: this.toStripeAmount(input.amount),
                  product_data: { name: `Order ${input.orderId}` },
                },
              },
            ],
      metadata: {
        orderId: input.orderId,
        paymentIntentId: input.paymentIntentId,
      },
      payment_intent_data: {
        metadata: {
          orderId: input.orderId,
          paymentIntentId: input.paymentIntentId,
        },
      },
    });

    this.logger.log(
      `Stripe Checkout Session ${session.id} for order ${input.orderId}`,
    );
    return session;
  }

  /** Create a single-use, fixed-amount Stripe Payment Link for an admin payment. */
  async createPaymentLink(input: {
    name: string;
    description?: string;
    amount: number;
    currency: 'AED' | 'USD';
    reference?: string;
  }): Promise<Stripe.PaymentLink> {
    const stripe = this.getClient();
    const name = input.name.trim();
    const description = input.description?.trim();
    const reference = input.reference?.trim();
    const currency = input.currency.toLowerCase();
    const unitAmount = this.toStripeAmount(input.amount);
    const minimumAmount = input.currency === 'AED' ? 2 : 0.5;

    if (!name) {
      throw new BadRequestException('A payment description is required');
    }
    if (
      !Number.isSafeInteger(unitAmount) ||
      input.amount < minimumAmount
    ) {
      throw new BadRequestException(
        `The minimum payment is ${minimumAmount.toFixed(2)} ${input.currency}`,
      );
    }

    const metadata: Record<string, string> = {
      source: 'partsbazar_admin',
      ...(reference ? { reference } : {}),
    };
    const product = await stripe.products.create({
      name,
      ...(description ? { description } : {}),
      metadata,
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency,
      unit_amount: unitAmount,
      metadata,
    });
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: false,
      after_completion: { type: 'hosted_confirmation' },
      restrictions: { completed_sessions: { limit: 1 } },
      metadata,
      payment_intent_data: { metadata },
    });

    this.logger.log(
      `Stripe Payment Link ${paymentLink.id} created (${currency.toUpperCase()} ${input.amount})`,
    );
    return paymentLink;
  }

  /**
   * Refunds the payment behind a completed Checkout Session. The session id
   * (what we store as PaymentIntent.externalId) isn't itself refundable —
   * Stripe refunds the underlying PaymentIntent, so this resolves that first.
   */
  async refundPayment(
    checkoutSessionId: string,
    reasonNote: string,
  ): Promise<Stripe.Refund> {
    const stripe = this.getClient();
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) {
      throw new BadRequestException(
        `Stripe session ${checkoutSessionId} has no captured payment to refund`,
      );
    }
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      metadata: { note: reasonNote.slice(0, 500) },
    });
    this.logger.log(
      `Stripe refund ${refund.id} issued for payment ${paymentIntentId} (session ${checkoutSessionId})`,
    );
    return refund;
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET on the API.',
      );
    }
    return this.getClient().webhooks.constructEvent(rawBody, signature, secret);
  }
}
