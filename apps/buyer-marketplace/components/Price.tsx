import { cn } from "@repo/ui/cn";
import { formatPrice } from "@/lib/format";

const SIZES = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-3xl",
};

export function Price({
  amount,
  currency,
  size = "md",
  from = false,
  className,
}: {
  amount: number | null | undefined;
  currency?: string | null;
  size?: keyof typeof SIZES;
  /** Renders a "From" qualifier for multi-offer lowest prices. */
  from?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      {from && <span className="text-xs font-normal text-slate-500">From</span>}
      <span className={cn("price", SIZES[size])}>{formatPrice(amount, currency)}</span>
    </span>
  );
}
