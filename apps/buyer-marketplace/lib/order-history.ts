import type { CartItem } from "./cart-context";
import type { SavedVehicle } from "./garage-context";

const STORAGE_KEY = "pb360_purchase_history_v1";

export interface StoredOrder {
  id: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  currency: string;
  sellerOrders: Array<{
    id: string;
    subTotal: number;
    shippingTotal: number;
    status?: string;
  }>;
  items: CartItem[];
  shippingAddress: {
    name: string;
    email: string;
    line1: string;
    line2?: string;
    city: string;
    country: string;
    postalCode?: string;
  };
  vehicle: SavedVehicle | null;
}

export function getStoredOrders(): StoredOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function storeOrder(order: StoredOrder) {
  const existing = getStoredOrders().filter((item) => item.id !== order.id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([order, ...existing]));
  window.dispatchEvent(new Event("pb360:orders-changed"));
}
