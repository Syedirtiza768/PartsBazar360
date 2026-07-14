"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { API_BASE_URL } from './api';

const SESSION_STORAGE_KEY = 'pb360_session_id';

function getSessionId(): string {
  if (typeof window === 'undefined') return '';
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
  sellerOffer: {
    id: string;
    price: number;
    currency?: string;
    condition?: string;
    seller?: { id: string; name: string };
    canonicalPart?: { id: string; title: string; imageUrls?: string[] };
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
  addToCart: (offerId: string, quantity?: number) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>({ id: null, items: [] });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const sessionId = getSessionId();
    if (!sessionId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/cart?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setCart({ id: data.id, items: data.items ?? [] });
    } catch (err) {
      console.error('Failed to load cart', err);
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

  const addToCart = useCallback(async (offerId: string, quantity = 1) => {
    setLoading(true);
    try {
      const cartId = await ensureCartId();
      const res = await fetch(`${API_BASE_URL}/cart/${cartId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId, quantity }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to add item to cart');
      }

      const data = await res.json();
      setCart({ id: data.id, items: data.items ?? [] });
    } finally {
      setLoading(false);
    }
  }, [ensureCartId]);

  const updateQuantity = useCallback(async (itemId: string, quantity: number) => {
    const cartId = await ensureCartId();
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/cart/${cartId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to update item');
      }
      const data = await res.json();
      setCart({ id: data.id, items: data.items ?? [] });
    } finally {
      setLoading(false);
    }
  }, [ensureCartId]);

  const removeItem = useCallback(async (itemId: string) => {
    const cartId = await ensureCartId();
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/cart/${cartId}/items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove item');
      const data = await res.json();
      setCart({ id: data.id, items: data.items ?? [] });
    } finally {
      setLoading(false);
    }
  }, [ensureCartId]);

  const itemCount = useMemo(
    () => cart.items.reduce((sum, item) => sum + item.quantity, 0),
    [cart.items],
  );

  const subtotal = useMemo(
    () => cart.items.reduce((sum, item) => sum + item.quantity * (item.sellerOffer?.price ?? 0), 0),
    [cart.items],
  );

  const value = useMemo(
    () => ({ cart, itemCount, subtotal, loading, addToCart, updateQuantity, removeItem, refresh }),
    [cart, itemCount, subtotal, loading, addToCart, updateQuantity, removeItem, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
