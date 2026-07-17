"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircleIcon, AlertCircleIcon, InfoIcon, XIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Optional action rendered as a small link-style button. */
  action?: { label: string; onClick: () => void };
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const TONE_STYLES: Record<ToastTone, { icon: ReactNode; bar: string }> = {
  success: {
    icon: <CheckCircleIcon className="h-5 w-5 text-emerald-600" />,
    bar: "bg-emerald-500",
  },
  error: {
    icon: <AlertCircleIcon className="h-5 w-5 text-red-600" />,
    bar: "bg-red-500",
  },
  info: {
    icon: <InfoIcon className="h-5 w-5 text-brand-600" />,
    bar: "bg-brand-500",
  },
};

const DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = ++counter.current;
      setToasts((prev) => [...prev.slice(-2), { ...input, id }]);
      window.setTimeout(() => dismiss(id), DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast viewport */}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 px-4 pb-4 sm:items-end sm:pb-6 sm:pr-6"
      >
        {toasts.map((toast) => {
          const tone = TONE_STYLES[toast.tone ?? "info"];
          return (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-overlay"
            >
              <span className={cn("absolute inset-y-0 left-0 w-1", tone.bar)} aria-hidden="true" />
              <span className="shrink-0">{tone.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-sm text-slate-500">{toast.description}</p>
                )}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    }}
                    className="mt-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
