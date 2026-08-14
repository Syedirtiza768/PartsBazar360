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
    serviceType?: string;
    /** Customer-facing estimated delivery window, e.g. "04 to 06 Business Days". */
    leadTime?: string | null;
    /**
     * True when the shipment exceeds courier limits. `amount` is then only the
     * price at that ceiling, and checkout is blocked pending a manual freight
     * quote — so this must be surfaced before the buyer reaches Pay.
     */
    requiresFreightQuote?: boolean;
    quotedWeightKg?: number;
    estimated?: boolean;
  }>;
};

type AuthHeaders = () => HeadersInit;

/**
 * Debounced live shipping quote for a cart destination. Public endpoint —
 * works for guests browsing checkout before they've verified a phone/email.
 * `authHeaders` is still sent when available; the server just ignores it.
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
    // A quote belongs to both the destination and the charge currency. Do not
    // keep displaying the previous quote while the new request is pending.
    setQuote(null);
    setError(null);
    setLoading(true);
    const timer = window.setTimeout(() => {
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
