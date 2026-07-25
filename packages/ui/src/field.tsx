"use client";

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

/**
 * Form primitives with built-in label / hint / error wiring.
 * Every control is labeled (visually or via aria-label) and errors are
 * announced through aria-describedby + aria-invalid.
 *
 * Sizing note: controls are 16px on phones and 14px from `sm` up. iOS Safari
 * zooms the whole viewport whenever a focused control renders below 16px and
 * never zooms back out, which strands the user mid-form at 1.3× with the rest
 * of the page off-screen. The preset enforces the same floor defensively, but
 * the primitives declare it explicitly so the intent is visible at the call
 * site.
 */

export const inputBaseClasses =
  "block w-full min-h-touch rounded-lg border bg-white px-3.5 py-2.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 " +
  "transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 " +
  "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed";

function borderFor(error?: string) {
  return error ? "border-red-400" : "border-slate-300 hover:border-slate-400";
}

interface FieldChrome {
  label?: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Visually hide the label while keeping it for screen readers. */
  hideLabel?: boolean;
  className?: string;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  hideLabel,
  className,
  children,
}: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div className={cn("w-full min-w-0", className)}>
      {label && (
        <label
          htmlFor={id}
          className={cn(
            "mb-1.5 block text-sm font-medium text-slate-700",
            hideLabel && "sr-only",
          )}
        >
          {label}
          {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {/*
        Validation messages sit in the flow rather than in a tooltip or an
        absolutely positioned bubble, so they can never be clipped by a drawer
        or scrolled out of reach on a short viewport.
      */}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-graphite-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">, FieldChrome {}

export function Input({ label, hint, error, required, hideLabel, className, ...rest }: InputProps) {
  const id = useId();
  return (
    <FieldShell {...{ id, label, hint, error, required, hideLabel, className }}>
      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(inputBaseClasses, borderFor(error))}
        {...rest}
      />
    </FieldShell>
  );
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className">, FieldChrome {}

export function Select({
  label,
  hint,
  error,
  required,
  hideLabel,
  className,
  children,
  ...rest
}: SelectProps) {
  const id = useId();
  return (
    <FieldShell {...{ id, label, hint, error, required, hideLabel, className }}>
      <div className="relative">
        <select
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          // `truncate` keeps a long option label (engine + transmission + trim)
          // from pushing the control wider than its grid cell.
          className={cn(inputBaseClasses, borderFor(error), "appearance-none truncate pr-10")}
          {...rest}
        >
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </FieldShell>
  );
}

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">, FieldChrome {}

export function Textarea({
  label,
  hint,
  error,
  required,
  hideLabel,
  className,
  ...rest
}: TextareaProps) {
  const id = useId();
  return (
    <FieldShell {...{ id, label, hint, error, required, hideLabel, className }}>
      <textarea
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(inputBaseClasses, borderFor(error), "min-h-[104px] resize-y")}
        {...rest}
      />
    </FieldShell>
  );
}

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "type"> {
  label: ReactNode;
  description?: string;
  className?: string;
}

/**
 * The whole row is the label, so the tap target is the full width of the field
 * rather than the 16px box — the difference between a checkbox that works with
 * a thumb and one that does not.
 */
export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-touch cursor-pointer items-start gap-3 py-1.5",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
        {...rest}
      />
      <span className="min-w-0 text-sm text-slate-700">
        {label}
        {description && <span className="mt-0.5 block text-xs text-graphite-600">{description}</span>}
      </span>
    </label>
  );
}

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "type"> {
  label: ReactNode;
  description?: string;
  className?: string;
}

export function Radio({ label, description, className, ...rest }: RadioProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-touch cursor-pointer items-start gap-3 py-1.5",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
        className,
      )}
    >
      <input
        id={id}
        type="radio"
        className="mt-0.5 h-5 w-5 shrink-0 border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
        {...rest}
      />
      <span className="min-w-0 text-sm text-slate-700">
        {label}
        {description && <span className="mt-0.5 block text-xs text-graphite-600">{description}</span>}
      </span>
    </label>
  );
}

/**
 * Groups related controls with a shared legend, and stacks them in one column
 * on phones. Use for address blocks, payment details, and anything a screen
 * reader should announce as one unit.
 */
export function Fieldset({
  legend,
  hint,
  columns = 2,
  className,
  children,
}: {
  legend: string;
  hint?: string;
  /** Column count from `sm` up; always one column below it. */
  columns?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="text-sm font-semibold text-slate-900">{legend}</legend>
      {hint && <p className="mt-1 text-xs text-graphite-600">{hint}</p>}
      <div
        className={cn(
          "mt-3 grid grid-cols-1 gap-x-4 gap-y-3.5",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {children}
      </div>
    </fieldset>
  );
}
