"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@repo/ui/cn";
import {
  DISPLAY_CURRENCIES,
  CURRENCY_LABELS,
  type DisplayCurrency,
} from "@/lib/currency";
import { useCurrency } from "@/lib/currency-context";

export function CurrencySwitcher({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { currency, setCurrency, ready, detectedCountry } = useCurrency();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (next: DisplayCurrency) => {
    setCurrency(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={!ready}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 font-semibold transition-colors",
          compact
            ? "text-[11px] text-white hover:text-brand-200"
            : "min-h-touch rounded-md border border-stone-300 bg-white px-2.5 text-sm text-graphite-800 hover:border-slate-400",
        )}
      >
        <span aria-hidden="true">¤</span>
        <span>{currency}</span>
        <span className="text-[10px] opacity-70" aria-hidden="true">
          ▾
        </span>
        <span className="sr-only">Change display currency</span>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Display currency"
          className={cn(
            "absolute z-dropdown mt-1 min-w-[12rem] overflow-hidden border-2 border-graphite-950 bg-white shadow-overlay",
            compact ? "right-0" : "left-0",
          )}
        >
          {detectedCountry && (
            <p className="border-b border-stone-200 px-3 py-2 text-[11px] text-graphite-600">
              Suggested from location: {detectedCountry}
            </p>
          )}
          {DISPLAY_CURRENCIES.map((code) => (
            <button
              key={code}
              type="button"
              role="option"
              aria-selected={code === currency}
              onClick={() => pick(code)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-stone-50",
                code === currency ? "bg-brand-50 font-semibold text-brand-800" : "text-graphite-800",
              )}
            >
              <span>{CURRENCY_LABELS[code]}</span>
              {code === currency ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
          <p className="border-t border-stone-200 px-3 py-2 text-[11px] leading-snug text-graphite-600">
            Prices convert for browsing. Checkout is charged in AED via Stripe.
          </p>
        </div>
      )}
    </div>
  );
}
