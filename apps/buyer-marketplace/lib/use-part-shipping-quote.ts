"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "./api";

export type PartShippingQuote = {
  weightState: "exact" | "estimated" | "pending";
  destinationCountry: string;
  currency: string;
  serviceType: string;
  leadTime: string | null;
  amount: number;
  requiresFreightQuote: boolean;
  estimated: boolean;
};

/**
 * Debounced live shipping quote for a single listing. Public endpoint — no
 * cart/session required, so it can resolve before the buyer adds anything.
 */
export function usePartShippingQuote(options: {
  partId: string | null | undefined;
  country: string;
  enabled?: boolean;
  debounceMs?: number;
}) {
  const { partId, country, enabled = true, debounceMs = 300 } = options;

  const [quote, setQuote] = useState<PartShippingQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = country.trim();
    if (!enabled || !partId || !trimmed) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      fetch(
        `${API_BASE_URL}/search/parts/${partId}/shipping-quote?country=${encodeURIComponent(trimmed)}`,
      )
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || "Unable to quote shipping.");
          if (!cancelled) setQuote(data as PartShippingQuote);
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
  }, [enabled, partId, country, debounceMs]);

  return { quote, loading, error };
}
