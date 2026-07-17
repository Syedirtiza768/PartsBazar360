import type { ReactNode } from "react";

/** Consistent page header: eyebrow, title, description, optional actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-slate-500 sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

export function StatCard({
  label,
  value,
  helper,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: ReactNode;
  helper?: string;
  tone?: "default" | "success" | "warning";
  loading?: boolean;
}) {
  const tones = {
    default: "text-slate-900",
    success: "text-emerald-700",
    warning: "text-amber-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      {loading ? (
        <div className="mt-2.5 h-9 w-28 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />
      ) : (
        <p className={`mt-1.5 text-3xl font-bold tabular-nums ${tones[tone]}`}>{value}</p>
      )}
      {helper && <p className="mt-1.5 text-xs text-slate-500">{helper}</p>}
    </div>
  );
}
