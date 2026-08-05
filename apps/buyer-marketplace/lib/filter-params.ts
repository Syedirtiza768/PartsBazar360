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
  | "sourceTag";

export type FilterGroupId =
  | "category"
  | "partType"
  | "brand"
  | "make"
  | "sourceTag"
  | "price"
  | "interchange";

export const MULTI_SELECT_FIELDS: FacetField[] = [
  "category",
  "categoryGroup",
  "brand",
  "make",
  "partType",
  "sourceTag",
];

export const FILTER_GROUPS: Array<{
  id: FilterGroupId;
  title: string;
  quick: boolean;
}> = [
  { id: "category", title: "Category", quick: true },
  { id: "partType", title: "Part Type", quick: true },
  { id: "brand", title: "Brand", quick: true },
  { id: "make", title: "Vehicle Make", quick: true },
  { id: "sourceTag", title: "Inventory", quick: true },
  { id: "price", title: "Price", quick: true },
  { id: "interchange", title: "Part Number Matching", quick: false },
];

export type FilterState = Record<FacetField, string[]> & {
  includeInterchange: boolean;
  minPrice: string;
  maxPrice: string;
};

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

export function paramsToFilterState(params: SearchParamsShape): FilterState {
  const out = {} as FilterState;
  for (const field of MULTI_SELECT_FIELDS) out[field] = csvList(params[field]);
  out.includeInterchange = params.includeInterchange !== "false";
  out.minPrice = params.minPrice ?? "";
  out.maxPrice = params.maxPrice ?? "";
  return out;
}

export function filterStateKey(state: FilterState): string {
  return (
    MULTI_SELECT_FIELDS.map((field) => `${field}:${[...state[field]].sort().join("|")}`).join(";") +
    `;interchange:${state.includeInterchange};min:${state.minPrice};max:${state.maxPrice}`
  );
}

export function filterStateToHref(base: SearchParamsShape, state: FilterState): string {
  const overrides: Record<string, string | undefined> = {
    includeInterchange: state.includeInterchange ? undefined : "false",
    minPrice: state.minPrice.trim() || undefined,
    maxPrice: state.maxPrice.trim() || undefined,
  };
  for (const field of MULTI_SELECT_FIELDS) {
    overrides[field] = state[field].length ? state[field].join(",") : undefined;
  }
  return buildHref(base, overrides);
}

export function hasPriceFilter(params: SearchParamsShape): boolean {
  return Boolean(params.minPrice || params.maxPrice);
}

export function priceFilterLabel(params: SearchParamsShape): string | null {
  const min = params.minPrice?.trim();
  const max = params.maxPrice?.trim();
  if (min && max) return `Price ${min}-${max}`;
  if (min) return `Price from ${min}`;
  if (max) return `Price up to ${max}`;
  return null;
}

export function priceStateLabel(state: Pick<FilterState, "minPrice" | "maxPrice">): string | null {
  const min = state.minPrice.trim();
  const max = state.maxPrice.trim();
  if (min && max) return `$${min}-$${max}`;
  if (min) return `From $${min}`;
  if (max) return `Up to $${max}`;
  return null;
}

export function countFilterState(state: FilterState): number {
  return (
    MULTI_SELECT_FIELDS.reduce((sum, field) => sum + state[field].length, 0) +
    (state.includeInterchange ? 0 : 1) +
    (state.minPrice || state.maxPrice ? 1 : 0)
  );
}

export function groupSelectedCount(groupId: FilterGroupId, state: FilterState): number {
  switch (groupId) {
    case "category":
      return state.categoryGroup.length + state.category.length;
    case "price":
      return state.minPrice || state.maxPrice ? 1 : 0;
    case "interchange":
      return state.includeInterchange ? 0 : 1;
    default:
      return state[groupId].length;
  }
}

export function groupSelectionSummary(
  groupId: FilterGroupId,
  state: FilterState,
  empty = "Any",
): string {
  const summarize = (values: string[], field: FacetField) => {
    if (values.length === 0) return empty;
    const labels = values.map((value) => displayLabelFor(field, value));
    if (labels.length <= 2) return labels.join(", ");
    return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
  };

  switch (groupId) {
    case "category": {
      const values = [...state.categoryGroup, ...state.category];
      return values.length ? summarize(values, "category") : empty;
    }
    case "price":
      return priceStateLabel(state) ?? empty;
    case "interchange":
      return state.includeInterchange ? "Interchange included" : "Exact only";
    case "partType":
      return summarize(state.partType, "partType");
    case "brand":
      return summarize(state.brand, "brand");
    case "make":
      return summarize(state.make, "make");
    case "sourceTag":
      return summarize(state.sourceTag, "sourceTag");
  }
}

/** Total selected values across all multi-select facets (for the drawer badge). */
export function countActiveFilters(params: SearchParamsShape): number {
  return countFilterState(paramsToFilterState(params));
}

/** Remove refinements without throwing away the buyer's search or display choices. */
export function clearFiltersHref(params: SearchParamsShape): string {
  const overrides: Record<string, string | undefined> = {
    condition: undefined,
    includeInterchange: undefined,
    minPrice: undefined,
    maxPrice: undefined,
  };
  for (const field of MULTI_SELECT_FIELDS) overrides[field] = undefined;
  return buildHref(params, overrides);
}
