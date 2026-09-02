import { roundMoney } from './currency.util';

type PurchaseTrackingOrder = {
  id: string;
  orderNumber?: string | null;
  status: string;
  totalAmount: number;
  discountAmount?: number | null;
  currency: string;
  paymentIntent?: { status?: string | null } | null;
  sellerOrders: Array<{
    shippingTotal: number;
    items: Array<{
      sellerOfferId: string;
      quantity: number;
      unitPrice: number;
      sellerOffer?: {
        sellerTitle?: string | null;
        canonicalPart?: {
          id?: string | null;
          title?: string | null;
        } | null;
      } | null;
    }>;
  }>;
};

export type PurchaseTrackingPayload = {
  transaction_id: string;
  value: number;
  currency: string;
  tax: number;
  shipping: number;
  items: Array<{
    item_id: string;
    item_name: string;
    price: number;
    quantity: number;
  }>;
};

/**
 * Build the browser-safe purchase payload from the immutable order snapshot.
 * Returning null is intentional until both our order and payment records have
 * independently reached their successful states.
 */
export function buildPurchaseTrackingPayload(
  order: PurchaseTrackingOrder,
): PurchaseTrackingPayload | null {
  if (order.status !== 'PAID' || order.paymentIntent?.status !== 'SUCCEEDED') {
    return null;
  }

  const items = order.sellerOrders.flatMap((sellerOrder) =>
    sellerOrder.items.map((item) => {
      const itemId =
        item.sellerOffer?.canonicalPart?.id?.trim() || item.sellerOfferId;
      const itemName =
        item.sellerOffer?.canonicalPart?.title?.trim() ||
        item.sellerOffer?.sellerTitle?.trim() ||
        itemId;

      return {
        item_id: itemId,
        item_name: itemName,
        price: roundMoney(Number(item.unitPrice)),
        quantity: Number(item.quantity),
      };
    }),
  );

  if (items.length === 0) return null;

  const itemSubtotal = roundMoney(
    items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  );
  const shipping = roundMoney(
    order.sellerOrders.reduce(
      (sum, sellerOrder) => sum + Number(sellerOrder.shippingTotal || 0),
      0,
    ),
  );
  const discount = roundMoney(Math.max(0, Number(order.discountAmount || 0)));
  const value = roundMoney(Number(order.totalAmount));
  // Tax is not a separate column today. Derive it from the charged total so
  // the payload stays correct if tax is introduced into order totals later.
  const inferredTax = roundMoney(value - (itemSubtotal - discount + shipping));
  const tax = inferredTax > 0 ? inferredTax : 0;

  return {
    transaction_id: order.orderNumber?.trim() || order.id,
    value,
    currency: order.currency.trim().toUpperCase(),
    tax,
    shipping,
    items,
  };
}
