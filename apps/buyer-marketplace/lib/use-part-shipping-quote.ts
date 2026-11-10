"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "./api";

export type PartShippingQuote = {
  weightState: "exact" | "estimated" | "pending";
  destinationCountry: string;
  currency: string;
  serviceType: string;
  leadTime: string | null;
  amount: number | null;
  available: boolean;
  availabilityReason?:
    | "DESTINATION_UNSUPPORTED"
    | "FREIGHT_QUOTE_REQUIRED"
    | "SPECIAL_HANDLING_REVIEW"
    | null;
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

  const [quoteRecord, setQuoteRecord] = useState<{
    key: string;
    quote: PartShippingQuote;
  } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorRecord, setErrorRecord] = useState<{
    key: string;
    error: string;
  } | null>(null);
  const requestKey = `${partId ?? ""}:${country.trim()}`;
  const quote = quoteRecord?.key === requestKey ? quoteRecord.quote : null;
  const loading = loadingKey === requestKey;
  const error = errorRecord?.key === requestKey ? errorRecord.error : null;

  useEffect(() => {
    const trimmed = country.trim();
    if (!enabled || !partId || !trimmed) {
      setLoadingKey(null);
      setErrorRecord(null);
      return;
    }

    let cancelled = false;
    const key = `${partId}:${trimmed}`;
    setLoadingKey(key);
    setErrorRecord(null);
    const timer = window.setTimeout(() => {
      fetch(
        `${API_BASE_URL}/search/parts/${partId}/shipping-quote?country=${encodeURIComponent(trimmed)}`,
      )
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok)
            throw new Error(data.message || "Unable to quote shipping.");
          if (!cancelled)
            setQuoteRecord({ key, quote: data as PartShippingQuote });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setErrorRecord({
              key,
              error:
                err instanceof Error
                  ? err.message
                  : "Unable to quote shipping.",
            });
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingKey(null);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, partId, country, debounceMs]);

  return { quote, loading, error };
}
