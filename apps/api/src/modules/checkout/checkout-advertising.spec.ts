import type { PrismaService } from '../../prisma.service';
import type { AdvertisingService } from '../advertising/advertising.service';
import type { CheckoutIdentityService } from './checkout-identity.service';
import { CheckoutService } from './checkout.service';
import type { StripeService } from './stripe.service';
import type { TamaraService } from './tamara.service';
import type { ReservationService } from '../inventory/reservation.service';
import type { OrderNotificationService } from '../order/order-notification.service';

describe.each(['stripe', 'tamara'] as const)(
  'advertising purchase from %s',
  (provider) => {
    it('queues a purchase on successful retry and skips failed, unpaid and replayed webhooks', async () => {
      let status = 'PENDING';
      const context = { consentId: 'browser-grant' };
      const enqueue = jest.fn();
      const advertise = {
        enabled: () => true,
        capture: (_tx: unknown, fn: () => Promise<unknown>) => fn(),
        checkoutContext: jest.fn().mockResolvedValue(context),
        enqueue,
      } as unknown as AdvertisingService;
      const order = {
        id: 'order-1',
        checkoutSessionId: 'checkout-1',
        checkoutSession: { cartId: 'cart-1' },
        currency: 'AED',
        status: 'PENDING_PAYMENT',
        totalAmount: 113,
        customerId: null,
        sellerOrders: [
          {
            shippingTotal: 13,
            items: [
              {
                sellerOfferId: 'offer-1',
                unitPrice: 50,
                quantity: 2,
                sellerOffer: {
                  canonicalPart: { id: 'part-1', title: 'Brake pads' },
                },
              },
            ],
          },
        ],
      };
      const payment = () => ({
        id: 'payment-1',
        orderId: order.id,
        externalId: 'provider-1',
        status,
        order,
        provider,
      });
      const tx = {
        paymentIntent: {
          findUniqueOrThrow: jest.fn(payment),
          updateMany: jest.fn(({ data }: { data: { status: string } }) => {
            status = data.status;
            return { count: 1 };
          }),
        },
        paymentAttempt: { updateMany: jest.fn() },
        order: { update: jest.fn() },
        inventory: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'stock-1', quantity: 2 }]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        sellerOrder: { updateMany: jest.fn() },
        cart: { update: jest.fn() },
      };
      const prisma = {
        paymentIntent: {
          findUnique: jest.fn(payment),
          findFirst: jest.fn(payment),
        },
        $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
          fn(tx),
        ),
      } as unknown as PrismaService;
      const stripeEvent = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'provider-1',
            metadata: { paymentIntentId: 'payment-1' },
            payment_status: 'unpaid',
          },
        },
      };
      const service = new CheckoutService(
        undefined as never,
        {
          releaseStock: jest.fn().mockResolvedValue(undefined),
        } as unknown as ReservationService,
        undefined as never,
        undefined as never,
        {
          constructWebhookEvent: () => stripeEvent,
        } as unknown as StripeService,
        { verifyWebhookToken: jest.fn() } as unknown as TamaraService,
        prisma,
        {
          notifyOrderUpdated: jest.fn().mockResolvedValue(undefined),
        } as unknown as OrderNotificationService,
        {
          trackEvent: jest.fn().mockResolvedValue(undefined),
        } as unknown as CheckoutIdentityService,
        advertise,
      );
      const sendStripe = () =>
        service.handleStripeWebhook(Buffer.from('{}'), 'fixture-signature');
      const sendTamara = (event_type: string) =>
        service.handleTamaraWebhook(
          { order_id: 'provider-1', order_reference_id: 'order-1', event_type },
          'fixture-token',
        );

      if (provider === 'stripe') {
        await sendStripe();
        stripeEvent.type = 'checkout.session.expired';
        await sendStripe();
      } else {
        await sendTamara('order_declined');
      }
      expect(enqueue).not.toHaveBeenCalled();

      if (provider === 'stripe') {
        stripeEvent.type = 'checkout.session.completed';
        stripeEvent.data.object.payment_status = 'paid';
        await sendStripe();
        await sendStripe();
      } else {
        await sendTamara('order_authorised');
        await sendTamara('order_captured');
      }

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(
        tx,
        {
          name: 'Purchase',
          id: 'order_order-1',
          value: 113,
          currency: 'AED',
          items: [
            {
              partId: 'part-1',
              offerId: 'offer-1',
              name: 'Brake pads',
              quantity: 2,
              price: 50,
            },
          ],
        },
        context,
      );
    });
  },
);
