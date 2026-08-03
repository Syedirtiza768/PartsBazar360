"use client";

import { useState } from "react";
import { SlidersIcon } from "@repo/ui/icons";
import { Sheet } from "@repo/ui/sheet";
import { FilterSectionsClient } from "@/components/FilterSectionsClient";
import type { SearchParamsShape } from "@/lib/filter-params";
import type { FacetsResponse } from "@/lib/types";

/**
 * Mobile filter experience: a trigger button + full-height drawer wrapping
 * FilterSectionsClient. Selections stage locally (zero navigation per tap);
 * the drawer only navigates — and closes — when the buyer taps "Apply
 * filters" in the sticky bar at the top of the content. There's no need to
 * keep the drawer open across navigations here (the old sessionStorage
 * bridge existed because every tap used to navigate immediately); a single
 * Apply is the one moment we want it to close.
 */
export function FilterDrawer({
  activeCount = 0,
  facets,
  params,
}: {
  activeCount?: number;
  facets: FacetsResponse;
  params: SearchParamsShape;
}) {
  const [open, setOpen] = useState(false);

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
        onClose={() => setOpen(false)}
        side="right"
        size="md"
        title={activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
        description="Select one or more options, then tap Apply filters."
      >
        <FilterSectionsClient facets={facets} params={params} onApply={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
