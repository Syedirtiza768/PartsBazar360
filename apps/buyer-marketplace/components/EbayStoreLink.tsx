import { ExternalLinkIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";

export const EBAY_STORE_URL = "https://ebay.io/m/7vngBN";

function EbayLogo({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex font-sans font-black tracking-[-0.14em]", className)}>
      <span className="text-[#e53238]">e</span>
      <span className="text-[#0064d2]">b</span>
      <span className="text-[#f5af02]">a</span>
      <span className="text-[#86b817]">y</span>
    </span>
  );
}

const VARIANT_CLASSES = {
  header:
    "inline-flex min-h-7 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 text-[11px] font-black text-white transition-colors hover:border-white hover:bg-white hover:text-graphite-950",
  prominent:
    "inline-flex min-h-12 items-center justify-center gap-3 border-2 border-brand-300 bg-white px-4 py-2.5 text-sm font-black uppercase tracking-wide text-graphite-950 shadow-[4px_4px_0_0_rgba(255,255,255,0.2)] transition-transform hover:-translate-y-0.5 hover:bg-brand-100 sm:px-5",
  menu:
    "flex min-h-12 w-full items-center justify-between gap-3 border-2 border-graphite-950 bg-white px-3 text-sm font-black text-graphite-950 transition-colors hover:bg-brand-100",
} as const;

export function EbayStoreLink({
  variant = "prominent",
  className,
}: {
  variant?: keyof typeof VARIANT_CLASSES;
  className?: string;
}) {
  return (
    <a
      href={EBAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(VARIANT_CLASSES[variant], className)}
      aria-label="Visit our Ebay Store (opens in a new tab)"
    >
      <EbayLogo className={variant === "header" ? "text-lg" : "text-2xl"} />
      <span>Visit our Ebay Store</span>
      <ExternalLinkIcon className="h-4 w-4 shrink-0" />
    </a>
  );
}
