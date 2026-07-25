import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Page-level heading block, shared by every portal so section pages line up
 * across apps.
 *
 * Actions wrap under the title on narrow screens instead of being squeezed
 * beside it; from `lg` they sit on the same baseline. The title itself uses the
 * fluid display scale, so a long page name does not stack four lines deep at
 * 320px.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>
        )}
        <h1 className="mt-1.5 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-pretty text-sm text-graphite-600 sm:text-base">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 lg:shrink-0">{actions}</div>
      )}
    </header>
  );
}

const STAT_TONES = {
  default: "text-slate-900",
  success: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-red-700",
} as const;

/**
 * Dashboard metric tile. The value uses `break-anywhere` + fluid sizing so a
 * long currency figure (e.g. "$1,284,905.20") shrinks rather than overflowing
 * its card on a 320px screen.
 */
export function StatCard({
  label,
  value,
  helper,
  tone = "default",
  loading = false,
  className,
}: {
  label: string;
  value: ReactNode;
  helper?: string;
  tone?: keyof typeof STAT_TONES;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5", className)}>
      <p className="text-sm font-medium text-graphite-600">{label}</p>
      {loading ? (
        <div className="mt-2.5 h-8 w-24 animate-pulse rounded-lg bg-slate-100 sm:h-9 sm:w-28" aria-hidden="true" />
      ) : (
        <p
          className={cn(
            "mt-1.5 break-anywhere text-2xl font-bold tabular-nums tracking-tight sm:text-3xl",
            STAT_TONES[tone],
          )}
        >
          {value}
        </p>
      )}
      {helper && <p className="mt-1.5 text-xs text-graphite-600">{helper}</p>}
    </div>
  );
}

/**
 * Responsive metric row. Two columns on the smallest screens (a single column
 * of stat tiles wastes most of the width and pushes content below the fold),
 * widening to four on desktop.
 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", className)}>{children}</div>
  );
}
