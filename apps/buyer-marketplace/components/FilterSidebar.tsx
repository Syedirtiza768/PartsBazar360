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

const CAR_PART_CATEGORY_NAMES = new Set([
  "body",
  "brakes",
  "cooling",
  "electrical",
  "engine",
  "exhaust",
  "interior",
  "suspension",
  "transmission",
  "wheels",
]);

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

function displayLabelFor(
  field: "category" | "brand" | "make" | "partType" | "sourceTag",
  name: string,
): string {
  return field === "partType" ? partTypeLabel(name) : name;
}

function cleanFacets(
  field: "category" | "brand" | "make" | "partType" | "sourceTag",
  facets: { name: string; count: number }[],
) {
  return facets.filter((facet) => {
    const name = facet.name.trim();
    if (!name) return false;
    if (field === "category") {
      return CAR_PART_CATEGORY_NAMES.has(name.toLowerCase());
    }
    if (field === "make") return name !== "-";
    return true;
  });
}

/** Toggle a value in a csv filter param, returning the new csv (or undefined). */
function toggleCsv(
  value: string | undefined,
  item: string,
): string | undefined {
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
    csvList(params.sourceTag).length +
    (params.includeInterchange === "false" ? 1 : 0)
  );
}

/** Remove refinements without throwing away the buyer's search or display choices. */
export function clearFiltersHref(params: SearchParamsShape): string {
  return buildHref(params, {
    category: undefined,
    brand: undefined,
    make: undefined,
    partType: undefined,
    sourceTag: undefined,
    includeInterchange: undefined,
  });
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
      className={cn(
        "group flex min-h-touch items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors lg:min-h-0",
        active
          ? "bg-brand-50 font-semibold text-brand-800 ring-1 ring-inset ring-brand-100"
          : "text-slate-600 hover:bg-white hover:text-slate-950",
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
      <span className="min-w-0 flex-1 truncate text-pretty">
        {label}
        {active && <span className="sr-only">, selected</span>}
      </span>
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
  selectedCount = 0,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  selectedCount?: number;
}) {
  return (
    <details
      open={defaultOpen}
      className="group border-b border-slate-200 pb-3 last:border-0"
    >
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 py-2.5 text-sm font-bold text-slate-950 lg:min-h-0 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          {title}
          {selectedCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-100 px-1.5 text-[11px] font-bold tabular-nums text-brand-800">
              {selectedCount}
            </span>
          )}
        </span>
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
  const selected = new Set(csvList(params[field]));
  const sorted = cleanFacets(field, facets).sort((a, b) => {
    const labelA = displayLabelFor(field, a.name);
    const labelB = displayLabelFor(field, b.name);
    return (
      labelA.localeCompare(labelB, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name)
    );
  });
  if (sorted.length === 0) return null;

  const preview = sorted.slice(0, 7);
  const visible = new Set(preview.map((facet) => facet.name));
  const rest = sorted.filter((facet) => !visible.has(facet.name));

  return (
    <FilterGroup
      title={title}
      defaultOpen={defaultOpen}
      selectedCount={selected.size}
    >
      {preview.map((f) => (
        <FilterOption
          key={f.name}
          href={buildHref(params, {
            [field]: toggleCsv(params[field], f.name),
          })}
          active={csvHas(params[field], f.name)}
          label={displayLabelFor(field, f.name)}
          count={f.count}
        />
      ))}
      {rest.length > 0 && (
        <details className="group/more">
          <summary className="flex min-h-touch cursor-pointer list-none items-center px-2.5 py-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800 lg:min-h-0 [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">
              Show {rest.length} more
            </span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <div className="space-y-0.5">
            {rest.map((f) => (
              <FilterOption
                key={f.name}
                href={buildHref(params, {
                  [field]: toggleCsv(params[field], f.name),
                })}
                active={csvHas(params[field], f.name)}
                label={displayLabelFor(field, f.name)}
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
  const refinementCount = countActiveFilters(params);
  if (params.q)
    chips.push({ field: "q", value: "", label: `\u201c${params.q}\u201d` });
  for (const field of [
    "category",
    "brand",
    "make",
    "partType",
    "sourceTag",
  ] as const) {
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
  if (chips.length === 0) return null;

  return (
    <div className="scrollbar-thin -mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      {chips.map((chip) => (
        <Link
          key={`${chip.field}:${chip.value}`}
          href={
            chip.field === "q"
              ? buildHref(params, { q: undefined })
              : chip.field === "includeInterchange"
                ? buildHref(params, { includeInterchange: undefined })
                : buildHref(params, {
                    [chip.field]: toggleCsv(params[chip.field], chip.value),
                  })
          }
          rel="nofollow"
          className="inline-flex min-h-9 max-w-full shrink-0 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-2 text-xs font-semibold text-brand-800 transition-colors hover:border-brand-300 hover:bg-brand-100"
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <XIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="sr-only">Remove filter {chip.label}</span>
        </Link>
      ))}
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
    <div className="space-y-1">
      {/* Only relevant to a keyword / part-number search. */}
      {params.q && (
        <FilterGroup title="Part number matching">
          <Link
            href={buildHref(params, {
              includeInterchange: interchangeOn ? "false" : undefined,
            })}
            rel="nofollow"
            aria-pressed={interchangeOn}
            className={cn(
              "group flex min-h-touch items-start gap-2.5 rounded-md px-2 py-2.5 text-sm transition-colors lg:min-h-0 lg:py-1.5",
              interchangeOn
                ? "font-semibold text-brand-700"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
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
              {interchangeOn && (
                <CheckIcon className="h-3 w-3" strokeWidth={3} />
              )}
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

      <FacetGroup
        field="category"
        title="Category"
        facets={categories}
        params={params}
      />
      <FacetGroup
        field="partType"
        title="Part type"
        facets={partTypes}
        params={params}
      />
      <FacetGroup field="brand" title="Brand" facets={brands} params={params} />
      <FacetGroup
        field="make"
        title="Fits vehicle make"
        facets={makes}
        params={params}
        defaultOpen={false}
      />
      <FacetGroup
        field="sourceTag"
        title="Tag"
        facets={sourceTags}
        params={params}
        defaultOpen={false}
      />
    </div>
  );
}
