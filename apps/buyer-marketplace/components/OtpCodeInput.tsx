"use client";

import { useEffect, useRef } from "react";
import { cn } from "@repo/ui/cn";

export function OtpCodeInput({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!disabled) refs.current[0]?.focus();
  }, [disabled]);

  const setDigit = (index: number, digit: string) => {
    const next = value.padEnd(6, " ").split("");
    next[index] = digit.slice(-1) || " ";
    const normalized = next.join("").replace(/\s/g, "").slice(0, 6);
    onChange(normalized);
    if (digit && index < 5) refs.current[index + 1]?.focus();
  };

  const applyWholeCode = (input: string) => {
    const digits = input.replace(/\D/g, "").slice(0, 6);
    if (!digits) return false;
    onChange(digits);
    refs.current[Math.min(digits.length, 6) - 1]?.focus();
    return true;
  };

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">
        Verification code
      </label>
      <div
        className="flex gap-2"
        onPaste={(event) => {
          if (applyWholeCode(event.clipboardData.getData("text"))) {
            event.preventDefault();
          }
        }}
      >
        {Array.from({ length: 6 }, (_, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            aria-label={`Digit ${index + 1} of 6`}
            value={value[index] || ""}
            disabled={disabled}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            pattern="[0-9]*"
            maxLength={1}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              const input = event.target.value.replace(/\D/g, "");
              // Mobile one-time-code autofill may place all six digits into
              // the first maxLength=1 field in a single input event.
              if (input.length > 1 && applyWholeCode(input)) return;
              setDigit(index, input);
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !value[index] && index > 0) {
                refs.current[index - 1]?.focus();
              }
              if (event.key === "ArrowLeft" && index > 0)
                refs.current[index - 1]?.focus();
              if (event.key === "ArrowRight" && index < 5)
                refs.current[index + 1]?.focus();
            }}
            className={cn(
              "h-12 min-w-0 flex-1 rounded-lg border bg-white text-center text-xl font-bold text-slate-950 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500",
              error ? "border-red-400" : "border-slate-300",
            )}
          />
        ))}
      </div>
      {error && (
        <p className="mt-2 text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
