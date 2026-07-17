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
 */

export const inputBaseClasses =
  "block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 " +
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
    <div className={cn("w-full", className)}>
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
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
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
          className={cn(inputBaseClasses, borderFor(error), "appearance-none pr-10")}
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
        className={cn(inputBaseClasses, borderFor(error), "min-h-[96px] resize-y")}
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

export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
        {...rest}
      />
      <span className="text-sm text-slate-700">
        {label}
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}
