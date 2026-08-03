import { partTypeLabel } from "@repo/catalog-contracts";

/**
 * Pure, framework-agnostic helpers for the /search filter query params.
 * Shared by the server-rendered pieces (FilterSidebar.tsx: chips, "clear
 * filters" links) and the client-side staged-selection UI
 * (FilterSectionsClient.tsx) so both agree on how params are parsed/built.
 */

export type SearchParamsShape = Record<string, string | undefined>;

export type FacetField =
  | "category"
  | "categoryGroup"
  | "brand"
  | "make"
  | "partType"
  | "condition"
  | "sourceTag";

export const MULTI_SELECT_FIELDS: FacetField[] = [
  "category",
  "categoryGroup",
  "brand",
  "make",
  "partType",
  "condition",
  "sourceTag",
];

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
export function csvList(value: string | undefined): string[] {
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

export function csvHas(value: string | undefined, item: string): boolean {
  return csvList(value).includes(item);
}

/** Toggle a value in a csv filter param, returning the new csv (or undefined). */
export function toggleCsv(
  value: string | undefined,
  item: string,
): string | undefined {
  const list = csvList(value);
  const next = list.includes(item)
    ? list.filter((v) => v !== item)
    : [...list, item];
  return next.length > 0 ? next.join(",") : undefined;
}

export function displayLabelFor(field: FacetField, name: string): string {
  return field === "partType" ? partTypeLabel(name) : name;
}

/** Total selected values across all multi-select facets (for the drawer badge). */
export function countActiveFilters(params: SearchParamsShape): number {
  return (
    MULTI_SELECT_FIELDS.reduce((sum, field) => sum + csvList(params[field]).length, 0) +
    (params.includeInterchange === "false" ? 1 : 0)
  );
}

/** Remove refinements without throwing away the buyer's search or display choices. */
export function clearFiltersHref(params: SearchParamsShape): string {
  const overrides: Record<string, string | undefined> = {
    includeInterchange: undefined,
  };
  for (const field of MULTI_SELECT_FIELDS) overrides[field] = undefined;
  return buildHref(params, overrides);
}
