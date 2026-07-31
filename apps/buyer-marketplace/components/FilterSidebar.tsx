import Link from "next/link";
import { CheckIcon, XIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { partTypeLabel } from "@repo/catalog-contracts";
import type { FacetsResponse } from "@/lib/types";

/**
 * Filter links styled as checkboxes — pure anchors, so filtering works
 * without JavaScript and every filtered view stays crawlable. Each facet is
 * multi-select (OR within a facet, AND across facets); counts come straight
 * from the scoped post-filter aggregations the API returns alongside the
 * results, so the number beside each option always agrees with the visible
 * result set.
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

/** Parse a csv filter param into a de-duplicated value set. */
function csvList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const v = raw.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function csvHas(value: string | undefined, item: string): boolean {
  return csvList(value).includes(item);
}

/** Toggle a value in a csv filter param, returning the new csv (or undefined). */
function toggleCsv(value: string | undefined, item: string): string | undefined {
  const list = csvList(value);
  const next = list.includes(item)
    ? list.filter((v) => v !== item)
    : [...list, item];
  return next.length > 0 ? next.join(",") : undefined;
}

/** Total selected values across all multi-select facets (for the drawer badge). */
export function countActiveFilters(params: SearchParamsShape): number {
  return (
    csvList(params.category).length +
    csvList(params.brand).length +
    csvList(params.make).length +
    csvList(params.partType).length +
    csvList(params.sourceTag).length
  );
}

function FilterOption({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      rel="nofollow"
      aria-pressed={active}
      className={cn(
        "group flex min-h-touch items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors lg:min-h-0",
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
      <span className="min-w-0 flex-1 truncate text-pretty">{label}</span>
      {count != null && (
        <span
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            active ? "text-brand-600" : "text-graphite-500",
          )}
        >
          {count.toLocaleString()}
        </span>
      )}
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
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 py-2 text-sm font-semibold text-slate-900 lg:min-h-0 [&::-webkit-details-marker]:hidden">
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

/** A multi-select facet group with "show more" and a per-option count. */
function FacetGroup({
  field,
  title,
  facets,
  params,
  defaultOpen = true,
}: {
  field: "category" | "brand" | "make" | "partType" | "sourceTag";
  title: string;
  facets: { name: string; count: number }[];
  params: SearchParamsShape;
  defaultOpen?: boolean;
}) {
  if (facets.length === 0) return null;
  const sorted = [...facets].sort((a, b) => a.name.localeCompare(b.name));
  const preview = sorted.slice(0, 6);
  const rest = sorted.slice(6);

  return (
    <FilterGroup title={title} defaultOpen={defaultOpen}>
      {preview.map((f) => (
        <FilterOption
          key={f.name}
          href={buildHref(params, { [field]: toggleCsv(params[field], f.name) })}
          active={csvHas(params[field], f.name)}
          label={f.name}
          count={f.count}
        />
      ))}
      {rest.length > 0 && (
        <details>
          <summary className="flex min-h-touch cursor-pointer list-none items-center px-2 py-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 lg:min-h-0 [&::-webkit-details-marker]:hidden">
            Show {rest.length} more
          </summary>
          <div className="space-y-0.5">
            {rest.map((f) => (
              <FilterOption
                key={f.name}
                href={buildHref(params, { [field]: toggleCsv(params[field], f.name) })}
                active={csvHas(params[field], f.name)}
                label={f.name}
                count={f.count}
              />
            ))}
          </div>
        </details>
      )}
    </FilterGroup>
  );
}

export function ActiveFilterChips({ params }: { params: SearchParamsShape }) {
  const chips: Array<{ field: string; value: string; label: string }> = [];
  if (params.q) chips.push({ field: "q", value: "", label: `\u201c${params.q}\u201d` });
  for (const field of ["category", "brand", "make", "partType", "sourceTag"] as const) {
    for (const value of csvList(params[field])) {
      chips.push({
        field,
        value,
        label: field === "partType" ? partTypeLabel(value) : value,
      });
    }
  }
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link
          key={`${chip.field}:${chip.value}`}
          href={
            chip.field === "q"
              ? buildHref(params, { q: undefined })
              : buildHref(params, { [chip.field]: toggleCsv(params[chip.field], chip.value) })
          }
          rel="nofollow"
          className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-2 text-xs font-semibold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-100"
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <XIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="sr-only">Remove filter {chip.label}</span>
        </Link>
      ))}
      <Link
        href="/search"
        rel="nofollow"
        className="inline-flex min-h-9 items-center px-1 text-xs font-medium text-graphite-600 underline-offset-2 hover:text-graphite-950 hover:underline"
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
  const makes = facets.makes ?? [];
  const partTypes = facets.partTypes ?? [];
  const sourceTags = facets.sourceTags ?? [];
  // Interchange matching is on unless the buyer turned it off.
  const interchangeOn = params.includeInterchange !== "false";

  return (
    <div className="space-y-4">
      {/* Only relevant to a keyword / part-number search. */}
      {params.q && (
        <FilterGroup title="Part number matching">
          <Link
            href={buildHref(params, { includeInterchange: interchangeOn ? "false" : undefined })}
            rel="nofollow"
            aria-pressed={interchangeOn}
            className={cn(
              "group flex min-h-touch items-start gap-2.5 rounded-md px-2 py-2.5 text-sm transition-colors lg:min-h-0 lg:py-1.5",
              interchangeOn ? "font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                interchangeOn
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-300 bg-white group-hover:border-slate-400",
              )}
            >
              {interchangeOn && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              Include interchange numbers
              <span className="mt-0.5 block text-xs font-normal text-graphite-600">
                Also match cross-reference and superseded part numbers.
              </span>
            </span>
          </Link>
        </FilterGroup>
      )}

      <FacetGroup field="sourceTag" title="Source" facets={sourceTags} params={params} />
      <FacetGroup field="brand" title="Brand" facets={brands} params={params} />
      <FacetGroup field="category" title="Category" facets={categories} params={params} />
      <FacetGroup field="partType" title="Part type" facets={partTypes} params={params} />
      <FacetGroup field="make" title="Vehicle make" facets={makes} params={params} defaultOpen={false} />
    </div>
  );
}