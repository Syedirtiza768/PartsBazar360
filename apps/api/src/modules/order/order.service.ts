import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private prisma: PrismaService) {}

  async createMultiSellerOrder(
    buyerId: string | undefined,
    cartItems: any[],
    shippingAddress: any,
    shippingTotalsBySeller: Record<string, number>
  ) {
    // We group cart items by Seller ID to split them into SellerOrders
    const itemsBySeller = cartItems.reduce((acc, item) => {
      const sellerId = item.sellerOffer.sellerId;
      if (!acc[sellerId]) acc[sellerId] = [];
      acc[sellerId].push(item);
      return acc;
    }, {} as Record<string, typeof cartItems>);

    let parentOrderTotal = 0;

    // Use Prisma Transaction to ensure atomic order creation
    return this.prisma.$transaction(async (tx) => {
      // Create Parent Order
      const parentOrder = await tx.order.create({
        data: {
          buyerId,
          totalAmount: 0, // Will update after summation
          shippingAddress,
          status: 'PENDING_PAYMENT'
        }
      });

      for (const [sellerId, items] of Object.entries(itemsBySeller) as [string, typeof cartItems][]) {
        let subTotal = 0;
        let marketplaceFeeTotal = 0;
        let sellerProceedsTotal = 0;
        for (const item of items) {
          subTotal += (item.quantity * item.sellerOffer.price);
          marketplaceFeeTotal += item.quantity * (item.sellerOffer.marketplaceFee ?? 0);
          sellerProceedsTotal += item.quantity * (item.sellerOffer.sellerProceeds ?? item.sellerOffer.price);
        }

        const shippingTotal = shippingTotalsBySeller[sellerId] || 0;
        parentOrderTotal += (subTotal + shippingTotal);

        // Create Child Seller Order
        const sellerOrder = await tx.sellerOrder.create({
          data: {
            parentOrderId: parentOrder.id,
            sellerId: sellerId,
            subTotal,
            shippingTotal,
            marketplaceFeeTotal,
            sellerProceedsTotal,
            status: 'AWAITING_PAYMENT',
          }
        });

        // Create Order Items
        for (const item of items) {
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
              weight: item.sellerOffer.canonicalPart?.weight
            }
          });
        }
      }

      // Update parent order total
      return tx.order.update({
        where: { id: parentOrder.id },
        data: { totalAmount: parentOrderTotal },
        include: { sellerOrders: { include: { items: true } } }
      });
    });
  }
}
