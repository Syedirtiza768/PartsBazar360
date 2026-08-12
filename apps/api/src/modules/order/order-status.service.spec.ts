import { BadRequestException } from '@nestjs/common';
import { SellerOrderStatus } from '@prisma/client';
import { OrderStatusService } from './order-status.service';

describe('OrderStatusService', () => {
  const service = new OrderStatusService();

  it('allows only the next fulfillment step', () => {
    expect(() =>
      service.assertSellerOrderTransition(
        SellerOrderStatus.PROCESSING,
        SellerOrderStatus.SHIPPED,
      ),
    ).not.toThrow();
    expect(() =>
      service.assertSellerOrderTransition(
        SellerOrderStatus.SHIPPED,
        SellerOrderStatus.DELIVERED,
      ),
    ).not.toThrow();
  });

  it('rejects skipping a fulfillment step or reopening a terminal shipment', () => {
    expect(() =>
      service.assertSellerOrderTransition(
        SellerOrderStatus.PROCESSING,
        SellerOrderStatus.DELIVERED,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertSellerOrderTransition(
        SellerOrderStatus.DELIVERED,
        SellerOrderStatus.PROCESSING,
      ),
    ).toThrow(BadRequestException);
  });
});
