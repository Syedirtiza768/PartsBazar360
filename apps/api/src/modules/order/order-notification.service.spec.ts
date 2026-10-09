import { OrderNotificationService } from './order-notification.service';

describe('OrderNotificationService payment timing', () => {
  const paidNotificationOrder = {
    id: 'order-1',
    orderNumber: 'PB1001',
    buyerId: null,
    customer: { email: 'buyer@example.com', phoneNormalized: null },
    shippingAddress: {
      email: 'buyer@example.com',
      line1: '10 Main Street',
      city: 'Dubai',
      country: 'AE',
    },
    verifiedPhone: null,
    totalAmount: 120,
    currency: 'AED',
    sellerOrders: [],
  };

  function setup() {
    const prisma = {
      order: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    const email = {
      sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
      sendOrderUpdateNotification: jest.fn().mockResolvedValue(undefined),
      sendAdminOrderUpdateNotification: jest.fn().mockResolvedValue(undefined),
    };
    const sms = {
      sendOrderConfirmationSms: jest.fn().mockResolvedValue(undefined),
      sendOrderUpdateSms: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new OrderNotificationService(
        prisma as any,
        email as any,
        sms as any,
      ),
      prisma,
      email,
      sms,
    };
  }

  it('suppresses all channels for a legacy order-created event', async () => {
    const { service, prisma, email, sms } = setup();

    await service.notifyOrderUpdated('order-1', {
      type: 'ORDER_CREATED',
      status: 'PENDING_PAYMENT',
    });

    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(email.sendOrderConfirmation).not.toHaveBeenCalled();
    expect(email.sendOrderUpdateNotification).not.toHaveBeenCalled();
    expect(email.sendAdminOrderUpdateNotification).not.toHaveBeenCalled();
    expect(sms.sendOrderConfirmationSms).not.toHaveBeenCalled();
    expect(sms.sendOrderUpdateSms).not.toHaveBeenCalled();
  });

  it('sends buyer payment confirmation and the admin update after payment', async () => {
    const { service, prisma, email, sms } = setup();
    prisma.order.findUnique.mockResolvedValue(paidNotificationOrder);

    await service.notifyOrderUpdated('order-1', {
      type: 'PAYMENT_STATUS_CHANGED',
      previousStatus: 'PENDING_PAYMENT',
      status: 'PAID',
    });

    expect(email.sendOrderConfirmation).toHaveBeenCalledWith(
      'buyer@example.com',
      expect.objectContaining({
        orderId: 'PB1001',
        totalAmount: 120,
        currency: 'AED',
      }),
    );
    expect(email.sendOrderUpdateNotification).not.toHaveBeenCalled();
    expect(email.sendAdminOrderUpdateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'PB1001',
        heading: 'Payment confirmed',
        status: 'PAID',
      }),
    );
    expect(sms.sendOrderConfirmationSms).not.toHaveBeenCalled();
  });
});
