"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  SETTLEMENT_CURRENCY,
  currencyForCountry,
  convertAmount,
  isDisplayCurrency,
  type DisplayCurrency,
} from "./currency";
import { formatPrice } from "./format";

const STORAGE_KEY = "pb360_display_currency";
const MANUAL_KEY = "pb360_currency_manual";

type CurrencyContextValue = {
  currency: DisplayCurrency;
  settlementCurrency: typeof SETTLEMENT_CURRENCY;
  ready: boolean;
  detectedCountry: string | null;
  isManual: boolean;
  setCurrency: (next: DisplayCurrency) => void;
  convert: (amount: number, fromCurrency?: string | null) => number;
  format: (amount: number | null | undefined, fromCurrency?: string | null) => string;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>(SETTLEMENT_CURRENCY);
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [isManual, setIsManual] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const manual = window.localStorage.getItem(MANUAL_KEY) === "1";
        if (manual && isDisplayCurrency(stored)) {
          if (!cancelled) {
            setCurrencyState(stored);
            setIsManual(true);
            setReady(true);
          }
          // Still fetch geo for badge/context, but don't override manual choice.
        }

        const res = await fetch("/buyer/api/geo", { cache: "no-store" });
        const data = res.ok ? await res.json() : null;
        const country =
          typeof data?.country === "string" && data.country.length === 2
            ? data.country.toUpperCase()
            : null;
        const suggested = isDisplayCurrency(data?.currency)
          ? (data.currency as DisplayCurrency)
          : currencyForCountry(country);

        if (cancelled) return;
        setDetectedCountry(country);

        if (manual && isDisplayCurrency(stored)) {
          setReady(true);
          return;
        }

        if (isDisplayCurrency(stored) && !manual) {
          // Prefer stored non-manual preference if user previously accepted IP pick.
          setCurrencyState(stored);
        } else {
          setCurrencyState(suggested);
          window.localStorage.setItem(STORAGE_KEY, suggested);
        }
        setIsManual(manual);
      } catch {
        if (!cancelled) setCurrencyState(SETTLEMENT_CURRENCY);
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrency = useCallback((next: DisplayCurrency) => {
    setCurrencyState(next);
    setIsManual(true);
    window.localStorage.setItem(STORAGE_KEY, next);
    window.localStorage.setItem(MANUAL_KEY, "1");
  }, []);

  const convert = useCallback(
    (amount: number, fromCurrency?: string | null) =>
      convertAmount(amount, fromCurrency, currency),
    [currency],
  );

  const format = useCallback(
    (amount: number | null | undefined, fromCurrency?: string | null) => {
      if (amount === null || amount === undefined || Number.isNaN(amount)) {
        return formatPrice(amount, currency);
      }
      return formatPrice(convertAmount(amount, fromCurrency, currency), currency);
    },
    [currency],
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      settlementCurrency: SETTLEMENT_CURRENCY,
      ready,
      detectedCountry,
      isManual,
      setCurrency,
      convert,
      format,
    }),
    [currency, ready, detectedCountry, isManual, setCurrency, convert, format],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within a CurrencyProvider");
  return ctx;
}
