"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import type { FacetsResponse, CategoryGroupFacet, Facet } from "@/lib/types";
import {
  buildHref,
  csvList,
  displayLabelFor,
  MULTI_SELECT_FIELDS,
  type FacetField,
  type SearchParamsShape,
} from "@/lib/filter-params";

/**
 * Client-side staged filtering: every checkbox toggles local state only —
 * zero navigation per click. A sticky "Apply filters" bar appears at the top
 * as soon as any selection differs from what's currently applied (the URL),
 * and a single navigation commits everything at once. Facet counts stay
 * frozen at the server-provided (last-applied) numbers while staging, so
 * there's no background request per click — the numbers refresh only once
 * Apply lands and the page re-renders with new results.
 *
 * `ActiveFilterChips` and the header "Clear filters" link (FilterSidebar.tsx)
 * intentionally stay plain server-rendered links — they act on the already-
 * applied state, not the pending selection, so an immediate navigation is
 * the right behavior there.
 */

type PendingState = Record<FacetField, string[]> & { includeInterchange: boolean };

function paramsToPending(params: SearchParamsShape): PendingState {
  const out = {} as PendingState;
  for (const field of MULTI_SELECT_FIELDS) out[field] = csvList(params[field]);
  out.includeInterchange = params.includeInterchange !== "false";
  return out;
}

function pendingKey(pending: PendingState): string {
  return (
    MULTI_SELECT_FIELDS.map((f) => `${f}:${[...pending[f]].sort().join("|")}`).join(";") +
    `;interchange:${pending.includeInterchange}`
  );
}

function pendingToHref(base: SearchParamsShape, pending: PendingState): string {
  const overrides: Record<string, string | undefined> = {
    includeInterchange: pending.includeInterchange ? undefined : "false",
  };
  for (const field of MULTI_SELECT_FIELDS) {
    overrides[field] = pending[field].length ? pending[field].join(",") : undefined;
  }
  return buildHref(base, overrides);
}

function totalSelected(pending: PendingState): number {
  return MULTI_SELECT_FIELDS.reduce((sum, f) => sum + pending[f].length, 0);
}

function FilterOption({
  active,
  disabled,
  label,
  count,
  onToggle,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  count?: number;
  onToggle: () => void;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="group flex min-h-touch items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-300 lg:min-h-0"
      >
        <span
          aria-hidden="true"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50"
        />
        <span className="min-w-0 flex-1 truncate text-pretty">{label}</span>
        {count != null && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-slate-300">0</span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "group flex min-h-touch w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors lg:min-h-0",
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
    </button>
  );
}

function FilterGroup({
  title,
  children,
  defaultOpen = true,
  selectedCount = 0,
  onClear,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  selectedCount?: number;
  onClear?: () => void;
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
        <div className="flex items-center gap-1">
          {selectedCount > 0 && onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }}
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-50 hover:text-brand-800"
            >
              Clear
            </button>
          )}
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
        </div>
      </summary>
      <div className="mt-1 space-y-0.5">{children}</div>
    </details>
  );
}

function cleanFacets(field: FacetField, facets: Facet[]) {
  return facets.filter((facet) => {
    const name = facet.name.trim();
    if (!name) return false;
    if (field === "make") return name !== "-";
    return true;
  });
}

/** A multi-select facet group with "show more" and a per-option count. */
function FacetGroup({
  field,
  title,
  facets,
  selected,
  onToggle,
  onClear,
  defaultOpen = true,
}: {
  field: FacetField;
  title: string;
  facets: Facet[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  defaultOpen?: boolean;
}) {
  if (facets.length === 0) return null;
  const sorted = cleanFacets(field, facets).sort((a, b) => {
    const aSelected = selected.has(a.name);
    const bSelected = selected.has(b.name);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;
    const labelA = displayLabelFor(field, a.name);
    const labelB = displayLabelFor(field, b.name);
    return (
      labelA.localeCompare(labelB, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name)
    );
  });
  if (sorted.length === 0) return null;

  const selectedItems = sorted.filter((f) => selected.has(f.name));
  const unselectedItems = sorted.filter((f) => !selected.has(f.name));
  const previewCount = Math.max(7, selectedItems.length);
  const preview = [
    ...selectedItems,
    ...unselectedItems.slice(0, Math.max(0, previewCount - selectedItems.length)),
  ];
  const visible = new Set(preview.map((facet) => facet.name));
  const rest = sorted.filter((facet) => !visible.has(facet.name));

  const renderOption = (f: Facet) => (
    <FilterOption
      key={f.name}
      active={selected.has(f.name)}
      disabled={f.count === 0 && !selected.has(f.name)}
      label={displayLabelFor(field, f.name)}
      count={f.count}
      onToggle={() => onToggle(f.name)}
    />
  );

  return (
    <FilterGroup title={title} defaultOpen={defaultOpen} selectedCount={selected.size} onClear={onClear}>
      {preview.map(renderOption)}
      {rest.length > 0 && (
        <details className="group/more">
          <summary className="flex min-h-touch cursor-pointer list-none items-center px-2.5 py-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800 lg:min-h-0 [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">Show {rest.length} more</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <div className="space-y-0.5">{rest.map(renderOption)}</div>
        </details>
      )}
    </FilterGroup>
  );
}

/** Hierarchical Category filter: groups at the top, categories nested underneath. */
function CategoryFacetGroup({
  categoryGroups,
  selectedGroups,
  selectedCats,
  onToggleGroup,
  onToggleCategory,
  onClear,
}: {
  categoryGroups: CategoryGroupFacet[];
  selectedGroups: Set<string>;
  selectedCats: Set<string>;
  onToggleGroup: (name: string) => void;
  onToggleCategory: (name: string) => void;
  onClear: () => void;
}) {
  if (categoryGroups.length === 0) return null;

  const sorted = categoryGroups
    .filter((g) => g.name.trim())
    .sort((a, b) => {
      const aSel = selectedGroups.has(a.name);
      const bSel = selectedGroups.has(b.name);
      if (aSel !== bSel) return aSel ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  if (sorted.length === 0) return null;

  const selectedItems = sorted.filter((g) => selectedGroups.has(g.name));
  const unselectedItems = sorted.filter((g) => !selectedGroups.has(g.name));
  const previewCount = Math.max(7, selectedItems.length);
  const preview = [
    ...selectedItems,
    ...unselectedItems.slice(0, Math.max(0, previewCount - selectedItems.length)),
  ];
  const visibleNames = new Set(preview.map((g) => g.name));
  const rest = sorted.filter((g) => !visibleNames.has(g.name));

  const totalSelectedCount = selectedGroups.size + selectedCats.size;

  const renderGroup = (g: CategoryGroupFacet) => {
    const groupSelected = selectedGroups.has(g.name);
    const hasSelectedChild = g.categories.some((c) => selectedCats.has(c.name));
    const cats = g.categories
      .filter((c) => c.name.trim())
      .sort((a, b) => {
        const aSel = selectedCats.has(a.name);
        const bSel = selectedCats.has(b.name);
        if (aSel !== bSel) return aSel ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

    return (
      <div key={g.name}>
        <FilterOption
          active={groupSelected}
          disabled={g.count === 0 && !groupSelected}
          label={g.name}
          count={g.count}
          onToggle={() => onToggleGroup(g.name)}
        />
        {cats.length > 0 && (
          <details className="group/cat ml-5" open={groupSelected || hasSelectedChild}>
            <summary className="flex min-h-touch cursor-pointer list-none items-center px-2.5 py-1 text-xs font-semibold text-brand-700 hover:text-brand-800 lg:min-h-0 [&::-webkit-details-marker]:hidden">
              <span className="group-open/cat:hidden">Show categories ({cats.length})</span>
              <span className="hidden group-open/cat:inline">Hide categories</span>
            </summary>
            <div className="ml-2.5 space-y-0.5 border-l border-slate-100 pl-2.5">
              {cats.map((c) => (
                <FilterOption
                  key={c.name}
                  active={selectedCats.has(c.name)}
                  disabled={c.count === 0 && !selectedCats.has(c.name)}
                  label={c.name}
                  count={c.count}
                  onToggle={() => onToggleCategory(c.name)}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    );
  };

  return (
    <FilterGroup title="Category" selectedCount={totalSelectedCount} onClear={onClear}>
      <div className="space-y-1">{preview.map(renderGroup)}</div>
      {rest.length > 0 && (
        <details className="group/more">
          <summary className="flex min-h-touch cursor-pointer list-none items-center px-2.5 py-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800 lg:min-h-0 [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">Show {rest.length} more</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <div className="space-y-1">{rest.map(renderGroup)}</div>
        </details>
      )}
    </FilterGroup>
  );
}

export function FilterSectionsClient({
  facets,
  params,
  onApply,
}: {
  facets: FacetsResponse;
  params: SearchParamsShape;
  /** Called right after the apply navigation fires — lets a wrapping drawer close itself. */
  onApply?: () => void;
}) {
  const router = useRouter();
  const applied = paramsToPending(params);
  const [pending, setPending] = useState<PendingState>(applied);

  // Re-sync whenever the URL's applied params actually change (Apply landed,
  // back/forward nav, a chip/nav link took us to a new filtered view).
  const appliedKey = pendingKey(applied);
  useEffect(() => {
    setPending(paramsToPending(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  const isDirty = pendingKey(pending) !== appliedKey;
  const pendingCount = totalSelected(pending);

  const toggle = (field: FacetField, value: string) => {
    setPending((prev) => {
      const list = prev[field];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [field]: next };
    });
  };

  const clearField = (field: FacetField) => {
    setPending((prev) => ({ ...prev, [field]: [] }));
  };

  const toggleInterchange = () => {
    setPending((prev) => ({ ...prev, includeInterchange: !prev.includeInterchange }));
  };

  const apply = () => {
    router.push(pendingToHref(params, pending));
    onApply?.();
  };

  const reset = () => setPending(applied);

  const categoryGroups = facets.categoryGroups ?? [];
  const brands = facets.brands ?? [];
  const makes = facets.makes ?? [];
  const partTypes = facets.partTypes ?? [];
  const sourceTags = facets.sourceTags ?? [];

  return (
    <div className="space-y-1">
      {isDirty && (
        <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 shadow-sm">
          <span className="text-xs font-semibold text-brand-800">
            {pendingCount > 0 ? `${pendingCount} selected` : "Filters changed"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded px-1.5 py-1 text-xs font-semibold text-graphite-600 hover:text-graphite-950"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700"
            >
              Apply filters
            </button>
          </div>
        </div>
      )}

      {/* Only relevant to a keyword / part-number search. */}
      {params.q && (
        <FilterGroup title="Part number matching">
          <button
            type="button"
            onClick={toggleInterchange}
            aria-pressed={pending.includeInterchange}
            className={cn(
              "group flex min-h-touch w-full items-start gap-2.5 rounded-md px-2 py-2.5 text-left text-sm transition-colors lg:min-h-0 lg:py-1.5",
              pending.includeInterchange
                ? "font-semibold text-brand-700"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                pending.includeInterchange
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-300 bg-white group-hover:border-slate-400",
              )}
            >
              {pending.includeInterchange && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              Include interchange numbers
              <span className="mt-0.5 block text-xs font-normal text-graphite-600">
                Also match cross-reference and superseded part numbers.
              </span>
            </span>
          </button>
        </FilterGroup>
      )}

      <CategoryFacetGroup
        categoryGroups={categoryGroups}
        selectedGroups={new Set(pending.categoryGroup)}
        selectedCats={new Set(pending.category)}
        onToggleGroup={(name) => toggle("categoryGroup", name)}
        onToggleCategory={(name) => toggle("category", name)}
        onClear={() => {
          clearField("categoryGroup");
          clearField("category");
        }}
      />
      <FacetGroup
        field="partType"
        title="Part type"
        facets={partTypes}
        selected={new Set(pending.partType)}
        onToggle={(v) => toggle("partType", v)}
        onClear={() => clearField("partType")}
      />
      <FacetGroup
        field="brand"
        title="Brand"
        facets={brands}
        selected={new Set(pending.brand)}
        onToggle={(v) => toggle("brand", v)}
        onClear={() => clearField("brand")}
      />
      <FacetGroup
        field="make"
        title="Fits vehicle make"
        facets={makes}
        selected={new Set(pending.make)}
        onToggle={(v) => toggle("make", v)}
        onClear={() => clearField("make")}
        defaultOpen={false}
      />
      <FacetGroup
        field="sourceTag"
        title="Tag"
        facets={sourceTags}
        selected={new Set(pending.sourceTag)}
        onToggle={(v) => toggle("sourceTag", v)}
        onClear={() => clearField("sourceTag")}
        defaultOpen={false}
      />
    </div>
  );
}
