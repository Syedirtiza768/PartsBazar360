"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { API_BASE_URL } from "./api";
import { useCurrency } from "./currency-context";
import { ecommerceMoney, pushAddToCart } from "./ecommerce-tracking";

const SESSION_STORAGE_KEY = "pb360_session_id";

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let sessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }
  return sessionId;
}

export interface CartItem {
  id: string;
  quantity: number;
  intendedVehicleConfigId?: string | null;
  purchaseIntent?: string;
  sellerOffer: {
    id: string;
    price: number;
    currency?: string;
    condition?: string;
    partSource?: string;
    partType?: string;
    shipmentLabel?: string;
    canonicalPart?: {
      id: string;
      slug?: string | null;
      title: string;
      imageUrls?: string[];
      partSource?: string;
      partType?: string;
      oeNumbers?: string[];
    };
  };
}

interface CartState {
  id: string | null;
  items: CartItem[];
}

interface CartContextValue {
  cart: CartState;
  itemCount: number;
  subtotal: number;
  loading: boolean;
  addToCart: (
    offerId: string,
    quantity?: number,
    vehicleConfigId?: string | null,
  ) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  setIntendedVehicle: (
    itemId: string,
    vehicleConfigId: string | null,
  ) => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>({ id: null, items: [] });
  const [loading, setLoading] = useState(false);
  const { currency, convert } = useCurrency();

  const refresh = useCallback(async () => {
    const sessionId = getSessionId();
    if (!sessionId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/cart?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setCart({ id: data.id, items: data.items ?? [] });
    } catch (err) {
      console.error("Failed to load cart", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ensureCartId = useCallback(async (): Promise<string> => {
    if (cart.id) return cart.id;
    const sessionId = getSessionId();
    const res = await fetch(`${API_BASE_URL}/cart?sessionId=${sessionId}`);
    const data = await res.json();
    setCart({ id: data.id, items: data.items ?? [] });
    return data.id;
  }, [cart.id]);

  const addToCart = useCallback(
    async (offerId: string, quantity = 1, vehicleConfigId?: string | null) => {
      setLoading(true);
      try {
        const cartId = await ensureCartId();
        const res = await fetch(`${API_BASE_URL}/cart/${cartId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offerId,
            quantity,
            ...(vehicleConfigId !== undefined ? { vehicleConfigId } : {}),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Failed to add item to cart");
        }

        const data = (await res.json()) as { id: string; items?: CartItem[] };
        const nextItems = data.items ?? [];
        setCart({ id: data.id, items: nextItems });

        // The response is the server-confirmed cart state, so a rejected add can
        // never reach this event.
        const addedLine = nextItems.find(
          (item) =>
            item.sellerOffer?.id === offerId &&
            (vehicleConfigId === undefined ||
              (item.intendedVehicleConfigId ?? null) === vehicleConfigId),
        );
        const product = addedLine?.sellerOffer?.canonicalPart;
        if (addedLine && product?.id && product.title) {
          const price = ecommerceMoney(
            convert(
              Number(addedLine.sellerOffer.price),
              addedLine.sellerOffer.currency,
            ),
          );
          pushAddToCart({
            currency,
            value: ecommerceMoney(price * quantity),
            items: [
              {
                item_id: product.id,
                item_name: product.title,
                price,
                quantity,
              },
            ],
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [convert, currency, ensureCartId],
  );

  const updateQuantity = useCallback(
    async (itemId: string, quantity: number) => {
      const cartId = await ensureCartId();
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/cart/${cartId}/items/${itemId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quantity }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Failed to update item");
        }
        const data = await res.json();
        setCart({ id: data.id, items: data.items ?? [] });
      } finally {
        setLoading(false);
      }
    },
    [ensureCartId],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      const cartId = await ensureCartId();
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/cart/${cartId}/items/${itemId}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error("Failed to remove item");
        const data = await res.json();
        setCart({ id: data.id, items: data.items ?? [] });
      } finally {
        setLoading(false);
      }
    },
    [ensureCartId],
  );

  const setIntendedVehicle = useCallback(
    async (itemId: string, vehicleConfigId: string | null) => {
      const cartId = await ensureCartId();
      const res = await fetch(
        `${API_BASE_URL}/cart/${cartId}/items/${itemId}/vehicle`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicleConfigId }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err.message || "Failed to update vehicle for this item",
        );
      }
      const data = await res.json();
      setCart({ id: data.id, items: data.items ?? [] });
    },
    [ensureCartId],
  );

  const itemCount = useMemo(
    () => cart.items.reduce((sum, item) => sum + item.quantity, 0),
    [cart.items],
  );

  const subtotal = useMemo(
    () =>
      cart.items.reduce(
        (sum, item) => sum + item.quantity * (item.sellerOffer?.price ?? 0),
        0,
      ),
    [cart.items],
  );

  const value = useMemo(
    () => ({
      cart,
      itemCount,
      subtotal,
      loading,
      addToCart,
      updateQuantity,
      removeItem,
      setIntendedVehicle,
      refresh,
    }),
    [
      cart,
      itemCount,
      subtotal,
      loading,
      addToCart,
      updateQuantity,
      removeItem,
      setIntendedVehicle,
      refresh,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
