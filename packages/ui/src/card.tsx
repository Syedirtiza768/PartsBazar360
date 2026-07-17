import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover elevation + pointer affordance for clickable cards. */
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

export function Card({ interactive = false, padding = "md", className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-card",
        interactive &&
          "transition-all duration-150 hover:shadow-card-hover hover:border-slate-300",
        PADDING[padding],
        className,
      )}
      {...rest}
    />
  );
}
