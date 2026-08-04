import { BadRequestException, Injectable } from '@nestjs/common';
import { SellerOrderStatus } from '@prisma/client';

const SELLER_ORDER_TRANSITIONS: Record<SellerOrderStatus, SellerOrderStatus[]> =
  {
    AWAITING_PAYMENT: [
      SellerOrderStatus.PROCESSING,
      SellerOrderStatus.CANCELLED,
    ],
    PROCESSING: [SellerOrderStatus.SHIPPED, SellerOrderStatus.CANCELLED],
    SHIPPED: [SellerOrderStatus.DELIVERED],
    CANCELLED: [],
    DELIVERED: [],
  };

/** Validates SellerOrder status writes so a PATCH can't jump the fulfillment lifecycle out of order. */
@Injectable()
export class OrderStatusService {
  assertSellerOrderTransition(
    from: SellerOrderStatus,
    to: SellerOrderStatus,
  ): void {
    if (from === to) return;
    const allowed = SELLER_ORDER_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Cannot move a seller order from ${from} to ${to}`,
      );
    }
  }
}
