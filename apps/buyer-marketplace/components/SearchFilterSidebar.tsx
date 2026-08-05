"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { AdvancedFiltersButton } from "@/components/FilterDrawer";
import { FilterSectionsClient } from "@/components/FilterSectionsClient";
import type { SearchParamsShape } from "@/lib/filter-params";
import type { FacetsResponse } from "@/lib/types";

export function SearchFilterSidebar({
  activeFilterCount,
  clearHref,
  facets,
  params,
  resultCount,
}: {
  activeFilterCount: number;
  clearHref: string;
  facets: FacetsResponse;
  params: SearchParamsShape;
  resultCount?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 self-start border-r border-slate-200 pr-4 transition-[width] duration-200 lg:sticky lg:top-44 lg:block lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto",
        collapsed ? "w-14" : "w-72",
      )}
      aria-label="Filters"
    >
      <div className="mb-2 flex min-h-10 items-center justify-between gap-3 border-b-2 border-slate-950 pb-2">
        {!collapsed && <h2 className="text-base font-bold text-slate-950">Filters</h2>}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand filters" : "Collapse filters"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-graphite-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
        >
          {collapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronLeftIcon className="h-4 w-4" />}
        </button>
        {!collapsed && activeFilterCount > 0 && (
          <Link
            href={clearHref}
            rel="nofollow"
            className="text-xs font-semibold text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline"
          >
            Clear filters
          </Link>
        )}
      </div>

      {collapsed ? (
        <div className="space-y-2">
          <AdvancedFiltersButton
            facets={facets}
            params={params}
            resultCount={resultCount}
            label=""
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-graphite-700 transition-colors hover:border-slate-400 hover:bg-slate-50 [&_svg]:h-4 [&_svg]:w-4"
          />
          {activeFilterCount > 0 && (
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </div>
      ) : (
        <>
          <FilterSectionsClient facets={facets} params={params} resultCount={resultCount} />
          <AdvancedFiltersButton
            facets={facets}
            params={params}
            resultCount={resultCount}
            className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-graphite-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
          />
        </>
      )}
    </aside>
  );
}
