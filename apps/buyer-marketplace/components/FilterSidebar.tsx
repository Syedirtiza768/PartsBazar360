import Link from "next/link";
import { CheckIcon, XIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import type { FacetsResponse } from "@/lib/types";

/**
 * Filter links styled as checkboxes — pure anchors, so filtering works
 * without JavaScript and every filtered view stays crawlable. Facet counts
 * from the backend cover a wider corpus than the browse index, so we present
 * names only (ordered by count) instead of contradictory numbers.
 */

export type SearchParamsShape = Record<string, string | undefined>;

export function buildHref(
  base: SearchParamsShape,
  overrides: Record<string, string | undefined>,
) {
  // Changing any filter resets pagination; pass an explicit `page` override
  // to paginate within the current filters.
  const merged: SearchParamsShape = { ...base, page: undefined, ...overrides };
  const qs = new URLSearchParams();
  Object.entries(merged).forEach(([key, value]) => {
    if (value) qs.set(key, value);
  });
  const str = qs.toString();
  return `/search${str ? `?${str}` : ""}`;
}

function FilterOption({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      rel="nofollow"
      aria-pressed={active}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          active
            ? "border-brand-600 bg-brand-600 text-white"
            : "border-slate-300 bg-white group-hover:border-slate-400",
        )}
      >
        {active && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}

function FilterGroup({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group border-b border-slate-100 pb-4 last:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
        {title}
        <svg
          className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="mt-1 space-y-0.5">{children}</div>
    </details>
  );
}

export function ActiveFilterChips({ params }: { params: SearchParamsShape }) {
  const chips: Array<{ key: string; label: string }> = [];
  if (params.q) chips.push({ key: "q", label: `“${params.q}”` });
  if (params.category) chips.push({ key: "category", label: params.category });
  if (params.brand) chips.push({ key: "brand", label: params.brand });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={buildHref(params, { [chip.key]: undefined })}
          rel="nofollow"
          className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-2 text-xs font-semibold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-100"
        >
          {chip.label}
          <XIcon className="h-3.5 w-3.5" />
          <span className="sr-only">Remove filter</span>
        </Link>
      ))}
      <Link
        href="/search"
        rel="nofollow"
        className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
      >
        Clear all
      </Link>
    </div>
  );
}

export function FilterSections({
  facets,
  params,
}: {
  facets: FacetsResponse;
  params: SearchParamsShape;
}) {
  const categories = facets.categories ?? [];
  const brands = facets.brands ?? [];

  return (
    <div className="space-y-4">
      {categories.length > 0 && (
        <FilterGroup title="Category">
          {params.category && (
            <FilterOption
              href={buildHref(params, { category: undefined })}
              active={false}
              label="All categories"
            />
          )}
          {categories.map((cat) => (
            <FilterOption
              key={cat.name}
              href={buildHref(params, {
                category: params.category === cat.name ? undefined : cat.name,
              })}
              active={params.category === cat.name}
              label={cat.name}
            />
          ))}
        </FilterGroup>
      )}

      {brands.length > 0 && (
        <FilterGroup title="Brand">
          {params.brand && (
            <FilterOption
              href={buildHref(params, { brand: undefined })}
              active={false}
              label="All brands"
            />
          )}
          {brands.slice(0, 10).map((b) => (
            <FilterOption
              key={b.name}
              href={buildHref(params, { brand: params.brand === b.name ? undefined : b.name })}
              active={params.brand === b.name}
              label={b.name}
            />
          ))}
          {brands.length > 10 && (
            <details>
              <summary className="cursor-pointer list-none px-2 py-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 [&::-webkit-details-marker]:hidden">
                Show all {brands.length} brands
              </summary>
              <div className="space-y-0.5">
                {brands.slice(10).map((b) => (
                  <FilterOption
                    key={b.name}
                    href={buildHref(params, {
                      brand: params.brand === b.name ? undefined : b.name,
                    })}
                    active={params.brand === b.name}
                    label={b.name}
                  />
                ))}
              </div>
            </details>
          )}
        </FilterGroup>
      )}
    </div>
  );
}
