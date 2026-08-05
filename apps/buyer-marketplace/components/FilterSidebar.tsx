import Link from "next/link";
import { XIcon } from "@repo/ui/icons";
import { partTypeLabel } from "@repo/catalog-contracts";
import {
  buildHref,
  csvList,
  toggleCsv,
  countActiveFilters,
  clearFiltersHref,
  priceFilterLabel,
  MULTI_SELECT_FIELDS,
  type SearchParamsShape,
} from "@/lib/filter-params";

/**
 * Server-rendered pieces of the filter UI: the "applied filters" chip row
 * and the shared param helpers. These act on the CURRENTLY APPLIED state (the
 * URL) so an immediate navigation on click is correct here — removing one
 * applied filter is a deliberate, single action, not part of the multi-select
 * staging flow.
 *
 * The actual checkbox/facet UI (category, brand, price, etc.) is a
 * client component — see FilterSectionsClient.tsx — so buyers can tick
 * multiple options with zero navigation and commit them all at once via its
 * sticky "Apply filters" bar.
 */

export type { SearchParamsShape } from "@/lib/filter-params";
export { buildHref, countActiveFilters, clearFiltersHref } from "@/lib/filter-params";

export function ActiveFilterChips({ params }: { params: SearchParamsShape }) {
  const chips: Array<{ field: string; value: string; label: string }> = [];
  const refinementCount = countActiveFilters(params);
  if (params.q)
    chips.push({ field: "q", value: "", label: `“${params.q}”` });
  for (const field of MULTI_SELECT_FIELDS) {
    for (const value of csvList(params[field])) {
      chips.push({
        field,
        value,
        label: field === "partType" ? partTypeLabel(value) : value,
      });
    }
  }
  if (params.includeInterchange === "false") {
    chips.push({
      field: "includeInterchange",
      value: "false",
      label: "Exact number only",
    });
  }
  const priceLabel = priceFilterLabel(params);
  if (priceLabel) {
    chips.push({ field: "price", value: "", label: priceLabel });
  }
  if (chips.length === 0) return null;
  const visibleChips = chips.slice(0, 5);
  const overflowChips = chips.slice(5);

  const chipHref = (chip: { field: string; value: string }) =>
    chip.field === "q"
      ? buildHref(params, { q: undefined })
      : chip.field === "includeInterchange"
        ? buildHref(params, { includeInterchange: undefined })
        : chip.field === "price"
          ? buildHref(params, { minPrice: undefined, maxPrice: undefined })
          : buildHref(params, {
              [chip.field]: toggleCsv(params[chip.field], chip.value),
            });

  return (
    <div className="scrollbar-thin -mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
      {visibleChips.map((chip) => (
        <Link
          key={`${chip.field}:${chip.value}`}
          href={chipHref(chip)}
          rel="nofollow"
          className="inline-flex min-h-9 max-w-full shrink-0 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-2 text-xs font-semibold text-brand-800 transition-colors hover:border-brand-300 hover:bg-brand-100"
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <XIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="sr-only">Remove filter {chip.label}</span>
        </Link>
      ))}
      {overflowChips.length > 0 && (
        <details className="relative shrink-0">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-graphite-700 shadow-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
            +{overflowChips.length} more
          </summary>
          <div className="absolute left-0 top-11 z-40 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-overlay">
            {overflowChips.map((chip) => (
              <Link
                key={`${chip.field}:${chip.value}`}
                href={chipHref(chip)}
                rel="nofollow"
                className="inline-flex min-h-9 items-center justify-between gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 text-xs font-semibold text-brand-800 hover:bg-brand-100"
              >
                <span className="min-w-0 truncate">{chip.label}</span>
                <XIcon className="h-3.5 w-3.5 shrink-0" />
              </Link>
            ))}
          </div>
        </details>
      )}
      {refinementCount > 0 && (
        <Link
          href={params.q ? clearFiltersHref(params) : "/search"}
          rel="nofollow"
          className="inline-flex min-h-9 shrink-0 items-center px-1 text-xs font-medium text-graphite-600 underline-offset-2 hover:text-graphite-950 hover:underline"
        >
          {params.q ? "Clear filters" : "Clear all"}
        </Link>
      )}
    </div>
  );
}
