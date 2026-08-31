import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../email/email.service';
import { SmsGlobalService } from '../sms/smsglobal.service';

export type OrderUpdateEvent = {
  type:
    | 'ORDER_CREATED'
    | 'PAYMENT_STATUS_CHANGED'
    | 'ORDER_STATUS_CHANGED'
    | 'SELLER_ORDER_UPDATED';
  previousStatus?: string | null;
  status: string;
  sellerOrderId?: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
  reason?: string;
};

function label(value: string | null | undefined): string {
  return value
    ? value
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^\w/, (char) => char.toUpperCase())
    : 'Unknown';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly smsGlobalService: SmsGlobalService,
  ) {}

  /**
   * Sends one order event to the buyer by email/SMS and always copies the
   * operations inbox. Provider failures are isolated so a notification cannot
   * roll back or change a successful order mutation.
   */
  async notifyOrderUpdated(
    orderId: string,
    event: OrderUpdateEvent,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { email: true, phoneNormalized: true } },
        sellerOrders: {
          include: {
            seller: { select: { name: true } },
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
    if (!order) return;

    const accountBuyer = order.buyerId
      ? await this.prisma.user.findUnique({
          where: { id: order.buyerId },
          select: { email: true, phone: true },
        })
      : null;
    const address = order.shippingAddress as Record<string, unknown> | null;
    const orderNumber = order.orderNumber || order.id;
    const emails = [
      order.customer?.email,
      accountBuyer?.email,
      stringValue(address?.email),
    ].filter(
      (value, index, all): value is string =>
        Boolean(value) && all.indexOf(value) === index,
    );
    const phone =
      order.verifiedPhone ||
      order.customer?.phoneNormalized ||
      accountBuyer?.phone ||
      stringValue(address?.phone);
    const sellerOrder = event.sellerOrderId
      ? order.sellerOrders.find((item) => item.id === event.sellerOrderId)
      : undefined;
    const trackingNumber =
      event.trackingNumber !== undefined
        ? event.trackingNumber
        : sellerOrder?.trackingNumber;
    const trackingUrl =
      event.trackingUrl !== undefined
        ? event.trackingUrl
        : sellerOrder?.trackingUrl;
    const carrier =
      event.carrier !== undefined ? event.carrier : sellerOrder?.carrier;
    const sellerName = event.sellerOrderId
      ? sellerOrder?.seller?.name || 'Marketplace seller'
      : undefined;
    const description = this.describe(orderNumber, event, sellerName);
    const tasks: Promise<void>[] = [];

    for (const email of emails) {
      if (event.type === 'PAYMENT_STATUS_CHANGED' && event.status === 'PAID') {
        tasks.push(
          this.emailService.sendOrderConfirmation(email, {
            orderId: orderNumber,
            totalAmount: order.totalAmount,
            currency: order.currency,
            items: order.sellerOrders.flatMap((sellerOrder) =>
              sellerOrder.items.map((item) => ({
                name:
                  item.sellerOffer.canonicalPart?.title ||
                  item.sellerOffer.sellerTitle ||
                  'Auto part',
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
            ),
            shippingAddress: address
              ? [
                  address.line1,
                  address.city,
                  address.region || address.state,
                  address.country,
                ]
                  .map(stringValue)
                  .filter(Boolean)
                  .join(', ')
              : undefined,
          }),
        );
      } else {
        tasks.push(
          this.emailService.sendOrderUpdateNotification(email, {
            orderId: order.id,
            orderNumber,
            heading: description.heading,
            message: description.message,
            status: event.status,
            sellerName,
            trackingNumber,
            trackingUrl,
            carrier,
          }),
        );
      }
    }

    if (phone) {
      if (event.type === 'PAYMENT_STATUS_CHANGED' && event.status === 'PAID') {
        tasks.push(
          this.smsGlobalService.sendOrderConfirmationSms(phone, {
            orderId: orderNumber,
            totalAmount: order.totalAmount,
            currency: order.currency,
          }),
        );
      } else {
        tasks.push(
          this.smsGlobalService.sendOrderUpdateSms(phone, {
            orderNumber,
            message: description.message,
            trackingUrl,
          }),
        );
      }
    }

    tasks.push(
      this.emailService.sendAdminOrderUpdateNotification({
        orderNumber,
        heading: description.heading,
        message: description.message,
        status: event.status,
        previousStatus: event.previousStatus,
        buyerEmail: emails[0],
        buyerPhone: phone,
        sellerName,
        trackingNumber,
        trackingUrl,
        carrier,
      }),
    );

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          `Order notification channel failed: ${result.reason}`,
        );
      }
    }
  }

  private describe(
    orderNumber: string,
    event: OrderUpdateEvent,
    sellerName?: string,
  ): { heading: string; message: string } {
    const previous = event.previousStatus
      ? ` from ${label(event.previousStatus)}`
      : '';
    const current = label(event.status);

    if (event.type === 'ORDER_CREATED') {
      return {
        heading: 'Order received',
        message: `Order ${orderNumber} has been created and is currently ${current}.`,
      };
    }
    if (event.type === 'PAYMENT_STATUS_CHANGED') {
      return {
        heading:
          event.status === 'PAID' ? 'Payment confirmed' : 'Payment update',
        message: `Order ${orderNumber} payment changed${previous} to ${current}.`,
      };
    }
    if (event.type === 'ORDER_STATUS_CHANGED') {
      return {
        heading: `Order ${current}`,
        message: `Order ${orderNumber} status changed${previous} to ${current}${event.reason ? `: ${event.reason}` : '.'}`,
      };
    }

    return {
      heading: event.trackingUrl
        ? 'Shipment tracking updated'
        : 'Delivery update',
      message: `${sellerName || 'A seller'} shipment for order ${orderNumber} is now ${current}${previous}.`,
    };
  }
}
