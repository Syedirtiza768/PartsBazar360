import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";

/** Windowed page list: 1 … (p-1) p (p+1) … N */
function pageWindow(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

function DoubleChevron({ side }: { side: "left" | "right" }) {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      {side === "left" ? (
        <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M13 6l6 6-6 6M5 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  // Show first/last jump buttons only when they are not already adjacent, so
  // they never clutter the controls near the edges of the result set.
  const showFirst = page > 3;
  const showLast = page < totalPages - 2;

  const itemBase =
    "flex h-11 min-w-11 items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors";

  return (
    <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
      <span className="sr-only">
        Page {page} of {totalPages}
      </span>

      {showFirst && (
        <Link
          href={hrefFor(1)}
          rel="nofollow"
          className={cn(itemBase, "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50")}
          aria-label="First page"
        >
          <DoubleChevron side="left" />
        </Link>
      )}

      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          rel="nofollow"
          className={cn(itemBase, "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50")}
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </Link>
      ) : (
        <span className={cn(itemBase, "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300")} aria-hidden="true">
          <ChevronLeftIcon className="h-4 w-4" />
        </span>
      )}

      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="hidden px-1.5 text-sm text-slate-400 xs:inline" aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            rel="nofollow"
            aria-current={p === page ? "page" : undefined}
            className={cn(
              itemBase,
              p === page
                ? "border-brand-600 bg-brand-600 font-semibold text-white"
                : "border-slate-300 bg-white text-graphite-700 hover:border-slate-400 hover:bg-slate-50",
              // Keep first / last / current visible on the narrowest screens
              // and drop the rest, rather than wrapping to a second row of
              // 44px chips that pushes the footer down.
              p !== page && p !== 1 && p !== totalPages && "hidden xs:flex",
            )}
          >
            {p}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link
          href={hrefFor(page + 1)}
          rel="nofollow"
          className={cn(itemBase, "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50")}
          aria-label="Next page"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      ) : (
        <span className={cn(itemBase, "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300")} aria-hidden="true">
          <ChevronRightIcon className="h-4 w-4" />
        </span>
      )}

      {showLast && (
        <Link
          href={hrefFor(totalPages)}
          rel="nofollow"
          className={cn(itemBase, "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50")}
          aria-label="Last page"
        >
          <DoubleChevron side="right" />
        </Link>
      )}
    </nav>
  );
}