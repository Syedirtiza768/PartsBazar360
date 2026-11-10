import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private prisma: PrismaService) {}

  async createMultiSellerOrder(
    buyerId: string | undefined,
    cartItems: any[],
    shippingAddress: any,
    shippingTotalsBySeller: Record<string, number>,
    currency = 'AED',
    identity?: {
      customerId: string;
      checkoutSessionId?: string;
      verifiedPhone: string;
      idempotencyKey: string;
      couponId?: string;
      couponCode?: string;
      discountAmount?: number;
      cartId: string;
      checkoutValidationId: string;
      checkoutValidationSnapshot: any;
      shippingQuoteSnapshotsBySeller: Record<string, unknown>;
    },
  ) {
    // We group cart items by Seller ID to split them into SellerOrders
    const itemsBySeller = cartItems.reduce(
      (acc, item) => {
        const sellerId = item.sellerOffer.sellerId;
        if (!acc[sellerId]) acc[sellerId] = [];
        acc[sellerId].push(item);
        return acc;
      },
      {} as Record<string, typeof cartItems>,
    );

    let parentOrderTotal = 0;
    const itemSubtotal = cartItems.reduce(
      (sum, item) => sum + item.quantity * item.sellerOffer.price,
      0,
    );
    const discountAmount = Math.min(
      Math.max(
        0,
        Math.round(Number(identity?.discountAmount ?? 0) * 100) / 100,
      ),
      Math.max(0, Math.round(itemSubtotal * 100) / 100),
    );

    // Use Prisma Transaction to ensure atomic order creation
    return this.prisma.$transaction(async (tx) => {
      const validationClaim = await tx.checkoutValidation.updateMany({
        where: {
          id: identity?.checkoutValidationId,
          cartId: identity?.cartId,
          checkoutSessionId: identity?.checkoutSessionId ?? null,
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

      // The row lock from this update serializes concurrent checkouts. Because
      // it is in the same transaction as the Order insert, failed or duplicate
      // checkout attempts roll the counter back and do not consume a number.
      const sequence = await tx.orderNumberSequence.update({
        where: { id: 1 },
        data: { lastNumber: { increment: 1 } },
      });

      // Create Parent Order
      const parentOrder = await tx.order.create({
        data: {
          orderNumber: 'PB' + sequence.lastNumber,
          buyerId,
          customerId: identity?.customerId,
          checkoutSessionId: identity?.checkoutSessionId,
          verifiedPhone: identity?.verifiedPhone,
          idempotencyKey: identity?.idempotencyKey,
          totalAmount: 0, // Will update after summation
          couponId: identity?.couponId,
          couponCode: identity?.couponCode,
          discountAmount,
          currency,
          shippingAddress,
          ...(identity?.checkoutValidationSnapshot
            ? {
                checkoutValidationSnapshot:
                  identity.checkoutValidationSnapshot as any,
              }
            : {}),
          status: 'PENDING_PAYMENT',
        },
      });

      for (const [sellerId, items] of Object.entries(itemsBySeller) as [
        string,
        typeof cartItems,
      ][]) {
        let subTotal = 0;
        let marketplaceFeeTotal = 0;
        let sellerProceedsTotal = 0;
        for (const item of items) {
          subTotal += item.quantity * item.sellerOffer.price;
          marketplaceFeeTotal +=
            item.quantity * (item.sellerOffer.marketplaceFee ?? 0);
          sellerProceedsTotal +=
            item.quantity *
            (item.sellerOffer.sellerProceeds ?? item.sellerOffer.price);
        }

        const shippingTotal = shippingTotalsBySeller[sellerId] || 0;
        const sellerDiscount =
          itemSubtotal > 0
            ? Math.round(((discountAmount * subTotal) / itemSubtotal) * 100) /
              100
            : 0;
        parentOrderTotal += subTotal + shippingTotal;

        // Create Child Seller Order
        const sellerOrder = await tx.sellerOrder.create({
          data: {
            parentOrderId: parentOrder.id,
            sellerId: sellerId,
            subTotal,
            discountTotal: sellerDiscount,
            shippingTotal,
            marketplaceFeeTotal,
            sellerProceedsTotal,
            ...(identity?.shippingQuoteSnapshotsBySeller?.[sellerId]
              ? {
                  shippingQuoteSnapshot: identity
                    .shippingQuoteSnapshotsBySeller[sellerId] as any,
                }
              : {}),
            status: 'AWAITING_PAYMENT',
          },
        });

        // Create Order Items
        for (const item of items) {
          const validationLine =
            identity?.checkoutValidationSnapshot?.lines?.find(
              (line: any) => line.cartItemId === item.id,
            ) ?? null;
          const part = item.sellerOffer.canonicalPart;
          await tx.orderItem.create({
            data: {
              sellerOrderId: sellerOrder.id,
              sellerOfferId: item.sellerOfferId,
              quantity: item.quantity,
              unitPrice: item.sellerOffer.price,
              sellerBaseUnitPrice: item.sellerOffer.sellerBasePrice,
              marketplaceFeeUnit: item.sellerOffer.marketplaceFee,
              sellerProceedsUnit: item.sellerOffer.sellerProceeds,
              pricingPolicyId: item.sellerOffer.pricingPolicyId,
              pricingPolicyVersion: item.sellerOffer.pricingPolicyVersion,
              weight: item.sellerOffer.canonicalPart?.weight,
              ...(part
                ? {
                    lineSnapshot: {
                      partId: part.id,
                      title: part.title,
                      slug: part.slug,
                      imageUrls: Array.isArray(part.imageUrls)
                        ? part.imageUrls
                        : [],
                      brand: part.brand,
                      partSource: part.partSource,
                      partType: part.partType,
                      manufacturerPartNumber: part.manufacturerPartNumber,
                      oeNumbers: Array.isArray(part.oeNumbers)
                        ? part.oeNumbers
                        : [],
                      condition: item.sellerOffer.condition,
                      unitPrice: item.sellerOffer.price,
                      currency: item.sellerOffer.currency,
                    } as any,
                  }
                : {}),
              ...(validationLine
                ? { decisionSnapshot: validationLine as any }
                : {}),
            },
          });
        }
      }

      // Coupons reduce the buyer-facing parent total, not seller payouts.
      parentOrderTotal = Math.max(0, parentOrderTotal - discountAmount);

      // Update parent order total
      return tx.order.update({
        where: { id: parentOrder.id },
        data: { totalAmount: Math.round(parentOrderTotal * 100) / 100 },
        include: { sellerOrders: { include: { items: true } } },
      });
    });
  }
}
