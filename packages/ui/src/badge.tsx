import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline"
  | "dark";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  brand: "bg-brand-50 text-brand-700 border-brand-100",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-700 border-red-200",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  outline: "bg-white text-slate-600 border-slate-300",
  dark: "bg-graphite-950 text-white border-graphite-950",
};

export interface BadgeProps {
  tone?: BadgeTone;
  size?: "sm" | "md";
  /** Leading icon element (sized by the badge). */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", size = "md", icon, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "gap-1 px-2 py-0.5 text-xs" : "gap-1.5 px-2.5 py-1 text-xs",
        TONES[tone],
        className,
      )}
    >
      {icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5 shrink-0 inline-flex">{icon}</span>}
      {children}
    </span>
  );
}
