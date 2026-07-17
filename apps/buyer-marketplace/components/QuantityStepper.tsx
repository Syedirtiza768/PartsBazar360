"use client";

import { MinusIcon, PlusIcon } from "@repo/ui/icons";

export function QuantityStepper({
  quantity,
  onChange,
  disabled = false,
  label = "Quantity",
}: {
  quantity: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-slate-300 bg-white"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={() => onChange(quantity - 1)}
        disabled={disabled || quantity <= 1}
        aria-label="Decrease quantity"
        className="flex h-9 w-9 items-center justify-center rounded-l-lg text-graphite-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        <MinusIcon className="h-4 w-4" />
      </button>
      <span className="w-9 select-none text-center text-sm font-semibold tabular-nums text-slate-900" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={disabled}
        aria-label="Increase quantity"
        className="flex h-9 w-9 items-center justify-center rounded-r-lg text-graphite-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
