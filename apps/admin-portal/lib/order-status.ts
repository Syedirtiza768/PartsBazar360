import type { BadgeTone } from "@repo/ui/badge";

/**
 * Single tone map for every status string that can appear on an order:
 * top-level OrderStatus, per-seller SellerOrderStatus, and PaymentStatus.
 * Shared between the orders list and order detail pages so a status always
 * reads the same color regardless of which page renders it.
 */
export const ORDER_STATUS_TONE: Record<string, BadgeTone> = {
  // OrderStatus
  PENDING_PAYMENT: "warning",
  PAID: "success",
  PAYMENT_FAILED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
  // SellerOrderStatus
  AWAITING_PAYMENT: "warning",
  PROCESSING: "warning",
  SHIPPED: "success",
  DELIVERED: "success",
  // PaymentStatus
  PENDING: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
};

export function orderStatusTone(status: string): BadgeTone {
  return ORDER_STATUS_TONE[status] || "neutral";
}
