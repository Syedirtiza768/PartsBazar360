"use client";

import { useState } from "react";
import { SlidersIcon } from "@repo/ui/icons";
import { Sheet } from "@repo/ui/sheet";
import {
  FilterApplyFooter,
  FilterSectionsClient,
  MobileFilterDrillIn,
  MobileFilterRows,
  useStagedFilters,
} from "@/components/FilterSectionsClient";
import type { FilterGroupId, SearchParamsShape } from "@/lib/filter-params";
import type { FacetsResponse } from "@/lib/types";

export function AdvancedFiltersButton({
  facets,
  params,
  resultCount,
  className,
  label = "All filters",
}: {
  facets: FacetsResponse;
  params: SearchParamsShape;
  resultCount?: number;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-label="Open all filters">
        <SlidersIcon className="h-4 w-4" />
        {label}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        side="right"
        size="lg"
        title="All filters"
        description="Refine the current result set without leaving the page until you apply."
        bodyClassName="px-5 py-4"
      >
        <FilterSectionsClient
          facets={facets}
          params={params}
          resultCount={resultCount}
          onApply={() => setOpen(false)}
          variant="advanced"
        />
      </Sheet>
    </>
  );
}

export function FilterDrawer({
  activeCount = 0,
  facets,
  params,
  resultCount,
}: {
  activeCount?: number;
  facets: FacetsResponse;
  params: SearchParamsShape;
  resultCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<FilterGroupId | null>(null);
  const controller = useStagedFilters({
    params,
    onApply: () => {
      setOpen(false);
      setActiveGroup(null);
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-touch items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-graphite-700 transition-colors hover:border-slate-400 hover:bg-slate-50 sm:min-h-10 lg:hidden"
        aria-expanded={open}
      >
        <SlidersIcon className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setActiveGroup(null);
        }}
        side="right"
        size="md"
        title={activeGroup ? "Choose filter" : activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
        footer={<FilterApplyFooter controller={controller} resultCount={resultCount} />}
      >
        {activeGroup ? (
          <MobileFilterDrillIn
            groupId={activeGroup}
            facets={facets}
            controller={controller}
            onBack={() => setActiveGroup(null)}
          />
        ) : (
          <MobileFilterRows
            facets={facets}
            params={params}
            controller={controller}
            onOpenGroup={setActiveGroup}
          />
        )}
      </Sheet>
    </>
  );
}
