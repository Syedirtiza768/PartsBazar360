"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, SlidersIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { Sheet } from "@repo/ui/sheet";
import { API_BASE_URL } from "@/lib/api";
import type { FacetsResponse, CategoryGroupFacet, Facet } from "@/lib/types";
import {
  FILTER_GROUPS,
  countFilterState,
  displayLabelFor,
  filterStateKey,
  filterStateToHref,
  groupSelectedCount,
  groupSelectionSummary,
  paramsToFilterState,
  type FacetField,
  type FilterGroupId,
  type FilterState,
  type SearchParamsShape,
} from "@/lib/filter-params";

type StagedFilterController = {
  applied: FilterState;
  appliedKey: string;
  pending: FilterState;
  pendingKey: string;
  isDirty: boolean;
  pendingCount: number;
  previewResultCount?: number;
  isPreviewLoading: boolean;
  toggle: (field: FacetField, value: string) => void;
  clearField: (field: FacetField) => void;
  clearGroup: (groupId: FilterGroupId) => void;
  updatePrice: (next: { minPrice?: string; maxPrice?: string }) => void;
  toggleInterchange: () => void;
  apply: () => void;
  reset: () => void;
};

function formatResultLabel(resultCount?: number) {
  if (resultCount == null) return "Show results";
  return `Show ${resultCount.toLocaleString()} ${resultCount === 1 ? "part" : "parts"}`;
}

export function useStagedFilters({
  params,
  resultCount,
  onApply,
}: {
  params: SearchParamsShape;
  resultCount?: number;
  onApply?: () => void;
}): StagedFilterController {
  const router = useRouter();
  const applied = useMemo(() => paramsToFilterState(params), [params]);
  const appliedKey = filterStateKey(applied);
  const [pending, setPending] = useState<FilterState>(applied);
  const [previewResultCount, setPreviewResultCount] = useState<number | undefined>(resultCount);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    setPending(paramsToFilterState(params));
  }, [appliedKey, params]);

  const pendingKey = filterStateKey(pending);
  const isDirty = pendingKey !== appliedKey;

  useEffect(() => {
    if (!isDirty) {
      setPreviewResultCount(resultCount);
      setIsPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsPreviewLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const href = filterStateToHref(params, pending);
        const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
        const search = new URLSearchParams(query);

        // The preview only needs the authoritative total. Removing display-only
        // parameters keeps the request small and ensures page size cannot win
        // over the one-result limit in the API controller.
        search.delete("page");
        search.delete("pageSize");
        search.delete("sort");
        search.set("limit", "1");
        search.set("countOnly", "true");

        const response = await fetch(`${API_BASE_URL}/search/parts?${search.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Count preview failed (${response.status})`);

        const data = (await response.json()) as { total?: unknown };
        const total = typeof data.total === "number" && Number.isFinite(data.total) ? data.total : undefined;
        setPreviewResultCount(total);
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setPreviewResultCount(undefined);
        }
      } finally {
        if (!controller.signal.aborted) setIsPreviewLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [appliedKey, isDirty, params, pending, pendingKey, resultCount]);

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

  const clearGroup = (groupId: FilterGroupId) => {
    setPending((prev) => {
      if (groupId === "category") return { ...prev, category: [], categoryGroup: [] };
      if (groupId === "price") return { ...prev, minPrice: "", maxPrice: "" };
      if (groupId === "interchange") return { ...prev, includeInterchange: true };
      return { ...prev, [groupId]: [] };
    });
  };

  const updatePrice = (next: { minPrice?: string; maxPrice?: string }) => {
    setPending((prev) => ({ ...prev, ...next }));
  };

  const toggleInterchange = () => {
    setPending((prev) => ({ ...prev, includeInterchange: !prev.includeInterchange }));
  };

  const apply = () => {
    router.push(filterStateToHref(params, pending));
    onApply?.();
  };

  return {
    applied,
    appliedKey,
    pending,
    pendingKey,
    isDirty,
    pendingCount: countFilterState(pending),
    previewResultCount,
    isPreviewLoading,
    toggle,
    clearField,
    clearGroup,
    updatePrice,
    toggleInterchange,
    apply,
    reset: () => setPending(applied),
  };
}

function cleanFacets(field: FacetField, facets: Facet[]) {
  return facets.filter((facet) => {
    const name = facet.name.trim();
    if (!name) return false;
    if (field === "make") return name !== "-";
    return true;
  });
}

function sortedFacets(field: FacetField, facets: Facet[], selected: Set<string>) {
  return cleanFacets(field, facets)
    .filter((facet) => facet.count > 0 || selected.has(facet.name))
    .sort((a, b) => {
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
        className="flex min-h-touch items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-300 lg:min-h-0"
      >
        <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded border border-slate-200 bg-slate-50" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count != null && <span className="shrink-0 font-mono text-xs tabular-nums">0</span>}
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
          active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white group-hover:border-slate-400",
        )}
      >
        {active && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {active && <span className="sr-only">, selected</span>}
      </span>
      {count != null && (
        <span className={cn("shrink-0 font-mono text-xs tabular-nums", active ? "text-brand-600" : "text-graphite-500")}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

function FilterGroupShell({
  title,
  summary,
  selectedCount,
  open,
  onToggle,
  onClear,
  children,
}: {
  title: string;
  summary: string;
  selectedCount: number;
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-slate-200 pb-2 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-touch w-full items-center justify-between gap-2 py-2.5 text-left lg:min-h-0"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-bold text-slate-950">
            {title}
            {selectedCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-100 px-1.5 text-[11px] font-bold tabular-nums text-brand-800">
                {selectedCount}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs font-medium text-graphite-600">{summary}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selectedCount > 0 && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClear();
              }}
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
            >
              Clear
            </span>
          )}
          <ChevronRightIcon className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && <div className="space-y-0.5 pb-2">{children}</div>}
    </section>
  );
}

function FacetOptions({
  field,
  facets,
  selected,
  onToggle,
  previewLimit = 7,
}: {
  field: FacetField;
  facets: Facet[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  previewLimit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const options = sortedFacets(field, facets, selected);
  if (options.length === 0) {
    return <p className="px-2.5 py-2 text-sm text-graphite-600">No options available.</p>;
  }
  const limit = Math.max(previewLimit, selected.size);
  const visible = showAll ? options : options.slice(0, limit);

  return (
    <>
      {visible.map((facet) => (
        <FilterOption
          key={facet.name}
          active={selected.has(facet.name)}
          disabled={facet.count === 0 && !selected.has(facet.name)}
          label={displayLabelFor(field, facet.name)}
          count={facet.count}
          onToggle={() => onToggle(facet.name)}
        />
      ))}
      {options.length > limit && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex min-h-touch items-center px-2.5 py-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800 lg:min-h-0"
        >
          {showAll ? "Show fewer" : `Show ${options.length - limit} more`}
        </button>
      )}
    </>
  );
}

function CategoryOptions({
  categoryGroups,
  selectedGroups,
  selectedCats,
  onToggleGroup,
  onToggleCategory,
  previewLimit = 7,
}: {
  categoryGroups: CategoryGroupFacet[];
  selectedGroups: Set<string>;
  selectedCats: Set<string>;
  onToggleGroup: (name: string) => void;
  onToggleCategory: (name: string) => void;
  previewLimit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = categoryGroups
    .filter((group) => {
      const name = group.name.trim();
      if (!name) return false;
      if (group.count > 0) return !/^general$/i.test(name) || selectedGroups.has(group.name);
      return selectedGroups.has(group.name) || group.categories.some((cat) => selectedCats.has(cat.name));
    })
    .sort((a, b) => {
      const aSelected = selectedGroups.has(a.name) || a.categories.some((cat) => selectedCats.has(cat.name));
      const bSelected = selectedGroups.has(b.name) || b.categories.some((cat) => selectedCats.has(cat.name));
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  if (sorted.length === 0) {
    return <p className="px-2.5 py-2 text-sm text-graphite-600">No categories available.</p>;
  }

  const limit = Math.max(previewLimit, selectedGroups.size + selectedCats.size);
  const visible = showAll ? sorted : sorted.slice(0, limit);

  return (
    <>
      <div className="space-y-1">
        {visible.map((group) => {
          const groupSelected = selectedGroups.has(group.name);
          const hasSelectedChild = group.categories.some((cat) => selectedCats.has(cat.name));
          const cats = group.categories
            .filter((cat) => {
              const name = cat.name.trim();
              if (!name || /^general$/i.test(name)) return selectedCats.has(cat.name);
              return cat.count > 0 || selectedCats.has(cat.name);
            })
            .sort((a, b) => {
              const aSelected = selectedCats.has(a.name);
              const bSelected = selectedCats.has(b.name);
              if (aSelected !== bSelected) return aSelected ? -1 : 1;
              return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
            });

          return (
            <div key={group.name}>
              <FilterOption
                active={groupSelected}
                disabled={group.count === 0 && !groupSelected}
                label={group.name}
                count={group.count}
                onToggle={() => onToggleGroup(group.name)}
              />
              {cats.length > 0 && (
                <details className="group/cat ml-5" open={groupSelected || hasSelectedChild}>
                  <summary className="flex min-h-touch cursor-pointer list-none items-center px-2.5 py-1 text-xs font-semibold text-brand-700 hover:text-brand-800 lg:min-h-0 [&::-webkit-details-marker]:hidden">
                    <span className="group-open/cat:hidden">Show categories ({cats.length})</span>
                    <span className="hidden group-open/cat:inline">Hide categories</span>
                  </summary>
                  <div className="ml-2.5 space-y-0.5 border-l border-slate-100 pl-2.5">
                    {cats.map((cat) => (
                      <FilterOption
                        key={cat.name}
                        active={selectedCats.has(cat.name)}
                        disabled={cat.count === 0 && !selectedCats.has(cat.name)}
                        label={cat.name}
                        count={cat.count}
                        onToggle={() => onToggleCategory(cat.name)}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
      {sorted.length > limit && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex min-h-touch items-center px-2.5 py-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800 lg:min-h-0"
        >
          {showAll ? "Show fewer" : `Show ${sorted.length - limit} more`}
        </button>
      )}
    </>
  );
}

function PriceOptions({
  minPrice,
  maxPrice,
  onChange,
}: {
  minPrice: string;
  maxPrice: string;
  onChange: (next: { minPrice?: string; maxPrice?: string }) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 px-2.5 py-1.5">
      <label className="min-w-0">
        <span className="mb-1 block text-[11px] font-semibold uppercase text-graphite-500">Min</span>
        <input
          inputMode="decimal"
          value={minPrice}
          onChange={(event) => onChange({ minPrice: event.target.value.replace(/[^\d.]/g, "") })}
          className="h-10 w-full rounded-md border border-slate-300 px-2 text-sm font-semibold text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          placeholder="0"
        />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-[11px] font-semibold uppercase text-graphite-500">Max</span>
        <input
          inputMode="decimal"
          value={maxPrice}
          onChange={(event) => onChange({ maxPrice: event.target.value.replace(/[^\d.]/g, "") })}
          className="h-10 w-full rounded-md border border-slate-300 px-2 text-sm font-semibold text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          placeholder="Any"
        />
      </label>
    </div>
  );
}

function InterchangeOptions({
  includeInterchange,
  onToggle,
}: {
  includeInterchange: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={includeInterchange}
      className={cn(
        "group flex min-h-touch w-full items-start gap-2.5 rounded-md px-2 py-2.5 text-left text-sm transition-colors lg:min-h-0 lg:py-1.5",
        includeInterchange ? "font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          includeInterchange ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white group-hover:border-slate-400",
        )}
      >
        {includeInterchange && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        Include interchange numbers
        <span className="mt-0.5 block text-xs font-normal text-graphite-600">
          Also match cross-reference and superseded part numbers.
        </span>
      </span>
    </button>
  );
}

function FilterGroupBody({
  groupId,
  facets,
  controller,
  previewLimit,
}: {
  groupId: FilterGroupId;
  facets: FacetsResponse;
  controller: StagedFilterController;
  previewLimit?: number;
}) {
  const { pending } = controller;

  if (groupId === "category") {
    return (
      <CategoryOptions
        categoryGroups={facets.categoryGroups ?? []}
        selectedGroups={new Set(pending.categoryGroup)}
        selectedCats={new Set(pending.category)}
        onToggleGroup={(name) => controller.toggle("categoryGroup", name)}
        onToggleCategory={(name) => controller.toggle("category", name)}
        previewLimit={previewLimit}
      />
    );
  }

  if (groupId === "price") {
    return <PriceOptions minPrice={pending.minPrice} maxPrice={pending.maxPrice} onChange={controller.updatePrice} />;
  }

  if (groupId === "interchange") {
    return <InterchangeOptions includeInterchange={pending.includeInterchange} onToggle={controller.toggleInterchange} />;
  }

  const facetMap: Record<Exclude<FilterGroupId, "category" | "price" | "interchange">, Facet[]> = {
    partType: facets.partTypes ?? [],
    brand: facets.brands ?? [],
    make: facets.makes ?? [],
    sourceTag: facets.sourceTags ?? [],
  };

  return (
    <FacetOptions
      field={groupId}
      facets={facetMap[groupId]}
      selected={new Set(pending[groupId])}
      onToggle={(value) => controller.toggle(groupId, value)}
      previewLimit={previewLimit}
    />
  );
}

function groupAvailable(groupId: FilterGroupId, facets: FacetsResponse, params: SearchParamsShape) {
  if (groupId === "interchange") return Boolean(params.q);
  if (groupId === "price") return true;
  if (groupId === "category") return (facets.categoryGroups ?? []).length > 0;
  if (groupId === "partType") return (facets.partTypes ?? []).length > 0;
  if (groupId === "brand") return (facets.brands ?? []).length > 0;
  if (groupId === "make") return (facets.makes ?? []).length > 0;
  return (facets.sourceTags ?? []).length > 0;
}

export function FilterApplyFooter({
  controller,
  resultCount,
}: {
  controller: StagedFilterController;
  resultCount?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">
          {controller.pendingCount > 0 ? `${controller.pendingCount} selected` : "No filters selected"}
        </p>
        {controller.isDirty && <p className="text-xs text-graphite-600">Changes are staged.</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={controller.reset}
          disabled={!controller.isDirty}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-graphite-600 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={controller.apply}
          disabled={controller.isDirty && controller.isPreviewLoading}
          aria-live="polite"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70"
        >
          {controller.isDirty && controller.isPreviewLoading
            ? "Checking…"
            : formatResultLabel(controller.isDirty ? controller.previewResultCount : resultCount)}
        </button>
      </div>
    </div>
  );
}

export function FilterSectionsClient({
  facets,
  params,
  resultCount,
  onApply,
  variant = "sidebar",
}: {
  facets: FacetsResponse;
  params: SearchParamsShape;
  resultCount?: number;
  onApply?: () => void;
  variant?: "sidebar" | "advanced";
}) {
  const controller = useStagedFilters({ params, resultCount, onApply });
  const groups = FILTER_GROUPS.filter((group) => groupAvailable(group.id, facets, params));
  const selectedGroup = groups.find((group) => groupSelectedCount(group.id, controller.pending) > 0)?.id;
  const [openGroup, setOpenGroup] = useState<FilterGroupId>(selectedGroup ?? groups[0]?.id ?? "price");

  useEffect(() => {
    if (!groups.some((group) => group.id === openGroup)) {
      setOpenGroup(groups[0]?.id ?? "price");
    }
  }, [groups, openGroup]);

  return (
    <div className="space-y-1">
      {controller.isDirty && (
        <div className="sticky top-0 z-10 -mx-1 mb-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 shadow-sm">
          <FilterApplyFooter controller={controller} resultCount={resultCount} />
        </div>
      )}

      {variant === "advanced" && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-graphite-700">
          All available filters use the same staged selections as the quick filters and sidebar.
        </div>
      )}

      {groups.map((group) => {
        const selectedCount = groupSelectedCount(group.id, controller.pending);
        const open = openGroup === group.id;
        return (
          <FilterGroupShell
            key={group.id}
            title={group.title}
            summary={groupSelectionSummary(group.id, controller.pending)}
            selectedCount={selectedCount}
            open={open}
            onToggle={() => setOpenGroup(open ? "price" : group.id)}
            onClear={() => controller.clearGroup(group.id)}
          >
            <FilterGroupBody
              groupId={group.id}
              facets={facets}
              controller={controller}
              previewLimit={variant === "advanced" ? 12 : 7}
            />
          </FilterGroupShell>
        );
      })}
    </div>
  );
}

export function QuickFilterRow({
  facets,
  params,
  resultCount,
}: {
  facets: FacetsResponse;
  params: SearchParamsShape;
  resultCount?: number;
}) {
  const controller = useStagedFilters({ params, resultCount });
  const [openGroup, setOpenGroup] = useState<FilterGroupId | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const groups = FILTER_GROUPS.filter((group) => group.quick && groupAvailable(group.id, facets, params)).slice(0, 6);

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (openGroup && barRef.current && !barRef.current.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    },
    [openGroup],
  );

  useEffect(() => {
    if (openGroup) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [openGroup, handleClickOutside]);

  return (
    <>
      <nav
        ref={barRef}
        className="relative flex flex-wrap items-center gap-1.5"
        aria-label="Quick filters"
      >
        {groups.map((group) => {
          const selectedCount = groupSelectedCount(group.id, controller.pending);
          const isOpen = openGroup === group.id;
          return (
            <div key={group.id} className="relative">
              <button
                type="button"
                onClick={() => setOpenGroup(isOpen ? null : group.id)}
                aria-expanded={isOpen}
                aria-haspopup="true"
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
                  selectedCount > 0
                    ? "border-brand-200 bg-brand-50 text-brand-800"
                    : "border-slate-200 bg-white text-graphite-700 hover:border-slate-300 hover:bg-slate-50",
                  isOpen && "border-brand-300 bg-brand-50 shadow-sm",
                )}
              >
                {group.title}
                {selectedCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
                    {selectedCount}
                  </span>
                )}
                <ChevronDownIcon
                  className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")}
                />
              </button>
              {isOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-overlay">
                  <div className="mb-2 flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-950">{group.title}</p>
                      <p className="truncate text-xs text-graphite-600">{groupSelectionSummary(group.id, controller.pending)}</p>
                    </div>
                    {selectedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => controller.clearGroup(group.id)}
                        className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto pr-1">
                    <FilterGroupBody groupId={group.id} facets={facets} controller={controller} previewLimit={6} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={controller.reset}
                      disabled={!controller.isDirty}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        controller.apply();
                        setOpenGroup(null);
                      }}
                      disabled={controller.isDirty && controller.isPreviewLoading}
                      aria-live="polite"
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70"
                    >
                      {controller.isDirty && controller.isPreviewLoading
                        ? "Checking…"
                        : formatResultLabel(controller.isDirty ? controller.previewResultCount : resultCount)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setAdvancedOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-graphite-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <SlidersIcon className="h-3.5 w-3.5" />
          All filters
        </button>
      </nav>
      <Sheet
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        side="right"
        size="lg"
        title="All filters"
        description="Use the full filter workspace for this result set."
      >
        <FilterSectionsClient
          facets={facets}
          params={params}
          resultCount={resultCount}
          onApply={() => setAdvancedOpen(false)}
          variant="advanced"
        />
      </Sheet>
    </>
  );
}

export function MobileFilterRows({
  facets,
  params,
  controller,
  onOpenGroup,
}: {
  facets: FacetsResponse;
  params: SearchParamsShape;
  controller: StagedFilterController;
  onOpenGroup: (groupId: FilterGroupId) => void;
}) {
  return (
    <div className="divide-y divide-slate-200">
      {FILTER_GROUPS.filter((group) => groupAvailable(group.id, facets, params)).map((group) => {
        const selectedCount = groupSelectedCount(group.id, controller.pending);
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => onOpenGroup(group.id)}
            className="flex min-h-[4.5rem] w-full items-center justify-between gap-3 py-3 text-left"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-950">
                {group.title}
                {selectedCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-100 px-1.5 text-[11px] font-bold text-brand-800">
                    {selectedCount}
                  </span>
                )}
              </span>
              <span className="mt-1 block truncate text-sm text-graphite-600">
                {groupSelectionSummary(group.id, controller.pending)}
              </span>
            </span>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        );
      })}
    </div>
  );
}

export function MobileFilterDrillIn({
  groupId,
  facets,
  controller,
  onBack,
}: {
  groupId: FilterGroupId;
  facets: FacetsResponse;
  controller: StagedFilterController;
  onBack: () => void;
}) {
  const group = FILTER_GROUPS.find((item) => item.id === groupId);
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 mb-3 inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-brand-700"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        Filters
      </button>
      <div className="mb-3 flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-slate-950">{group?.title ?? "Filter"}</h3>
          <p className="truncate text-sm text-graphite-600">{groupSelectionSummary(groupId, controller.pending)}</p>
        </div>
        {groupSelectedCount(groupId, controller.pending) > 0 && (
          <button
            type="button"
            onClick={() => controller.clearGroup(groupId)}
            className="text-sm font-semibold text-brand-700"
          >
            Clear
          </button>
        )}
      </div>
      <FilterGroupBody groupId={groupId} facets={facets} controller={controller} previewLimit={24} />
    </div>
  );
}
