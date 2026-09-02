"use client";

export type EcommerceItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
};

export type EcommercePayload = {
  currency: string;
  value: number;
  items: EcommerceItem[];
};

export type PurchaseEcommercePayload = EcommercePayload & {
  transaction_id: string;
  tax: number;
  shipping: number;
};

type EcommerceEventName =
  "view_item" | "add_to_cart" | "begin_checkout" | "purchase";

type DataLayerEntry =
  | { ecommerce: null }
  | {
      event: EcommerceEventName;
      ecommerce: EcommercePayload | PurchaseEcommercePayload;
    };

declare global {
  interface Window {
    dataLayer?: DataLayerEntry[];
  }
}

const PURCHASE_KEY_PREFIX = "pb360_gtm_purchase_v1:";
const CHECKOUT_KEY_PREFIX = "pb360_gtm_begin_checkout_v1:";

export function ecommerceMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function validItem(item: EcommerceItem) {
  return (
    Boolean(item.item_id.trim()) &&
    Boolean(item.item_name.trim()) &&
    Number.isFinite(item.price) &&
    item.price >= 0 &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0
  );
}

function pushEcommerceEvent(
  event: EcommerceEventName,
  ecommerce: EcommercePayload | PurchaseEcommercePayload,
) {
  if (typeof window === "undefined") return false;
  if (
    !ecommerce.currency.trim() ||
    !Number.isFinite(ecommerce.value) ||
    ecommerce.value < 0 ||
    ecommerce.items.length === 0 ||
    !ecommerce.items.every(validItem)
  ) {
    return false;
  }

  window.dataLayer = window.dataLayer || [];
  // Clear the previous ecommerce object so GTM never merges stale item data
  // into the next event.
  window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push({
    event,
    ecommerce: {
      ...ecommerce,
      currency: ecommerce.currency.trim().toUpperCase(),
      value: ecommerceMoney(ecommerce.value),
      items: ecommerce.items.map((item) => ({
        ...item,
        item_id: item.item_id.trim(),
        item_name: item.item_name.trim(),
        price: ecommerceMoney(item.price),
      })),
    },
  });
  return true;
}

export function pushViewItem(ecommerce: EcommercePayload) {
  return pushEcommerceEvent("view_item", ecommerce);
}

export function pushAddToCart(ecommerce: EcommercePayload) {
  return pushEcommerceEvent("add_to_cart", ecommerce);
}

export function pushBeginCheckoutOnce(
  checkoutSessionId: string,
  ecommerce: EcommercePayload,
) {
  if (typeof window === "undefined") return false;
  const storageKey = `${CHECKOUT_KEY_PREFIX}${encodeURIComponent(checkoutSessionId)}`;
  try {
    if (window.sessionStorage.getItem(storageKey)) return false;
  } catch {
    // Tracking remains best-effort when storage is unavailable.
  }
  const pushed = pushEcommerceEvent("begin_checkout", ecommerce);
  if (pushed) {
    try {
      window.sessionStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // The event has already been emitted; storage failure must not affect UX.
    }
  }
  return pushed;
}

export function pushPurchaseOnce(ecommerce: PurchaseEcommercePayload) {
  if (typeof window === "undefined" || !ecommerce.transaction_id.trim()) {
    return false;
  }
  const storageKey = `${PURCHASE_KEY_PREFIX}${encodeURIComponent(
    ecommerce.transaction_id.trim(),
  )}`;
  try {
    if (window.localStorage.getItem(storageKey)) return false;
  } catch {
    // Tracking remains best-effort when storage is unavailable.
  }

  const pushed = pushEcommerceEvent("purchase", {
    ...ecommerce,
    transaction_id: ecommerce.transaction_id.trim(),
    tax: ecommerceMoney(ecommerce.tax),
    shipping: ecommerceMoney(ecommerce.shipping),
  });
  if (pushed) {
    try {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // The transaction_id still lets downstream GA4 tags deduplicate safely.
    }
  }
  return pushed;
}
