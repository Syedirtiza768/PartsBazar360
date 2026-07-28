"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "./api";

export type ShippingQuote = {
  currency: string;
  settlementCurrency?: string;
  destinationCountry: string;
  shippingTotal: number;
  totalAmount: number;
  sellerQuotes: Array<{
    sellerId: string;
    sellerName: string;
    amount: number;
    matchedCountry: boolean;
  }>;
};

type AuthHeaders = () => HeadersInit;

/**
 * Debounced live shipping quote for a cart destination.
 * Requires auth — the quote endpoint is JWT-guarded.
 */
export function useShippingQuote(options: {
  cartId: string | null | undefined;
  country: string;
  currency: string;
  enabled?: boolean;
  authHeaders: AuthHeaders;
  debounceMs?: number;
}) {
  const {
    cartId,
    country,
    currency,
    enabled = true,
    authHeaders,
    debounceMs = 300,
  } = options;

  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = country.trim();
    if (!enabled || !cartId || !trimmed) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      fetch(`${API_BASE_URL}/checkout/${cartId}/shipping-quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ country: trimmed, currency }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || "Unable to quote shipping.");
          if (!cancelled) setQuote(data as ShippingQuote);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setQuote(null);
            setError(err instanceof Error ? err.message : "Unable to quote shipping.");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, cartId, country, currency, authHeaders, debounceMs]);

  return { quote, loading, error };
}
