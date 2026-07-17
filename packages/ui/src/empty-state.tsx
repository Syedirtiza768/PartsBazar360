import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Action buttons / links rendered under the description. */
  children?: ReactNode;
  className?: string;
  /** "page" for full empty pages, "panel" for embedded areas. */
  variant?: "page" | "panel";
}

export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
  variant = "panel",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center",
        variant === "page" ? "px-6 py-20 sm:py-24" : "px-6 py-12",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 [&>svg]:h-6 [&>svg]:w-6">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-slate-500">{description}</p>}
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </div>
  );
}
