"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { SlidersIcon } from "@repo/ui/icons";
import { Button, buttonClasses } from "@repo/ui/button";
import { Sheet } from "@repo/ui/sheet";

/**
 * Mobile filter experience: a trigger button + full-height drawer. The filter
 * links themselves are server-rendered and passed in as children, so the
 * drawer is just presentation.
 *
 * Built on the shared Sheet, which supplies the focus trap, iOS-safe scroll
 * lock, dynamic-viewport height cap and safe-area footer padding — the
 * hand-rolled version pinned "Show results" to `bottom-0` with no inset, so it
 * sat under the home indicator on every notched iPhone.
 */
export function FilterDrawer({
  children,
  activeCount = 0,
  resultCount,
  clearHref,
}: {
  children: ReactNode;
  activeCount?: number;
  resultCount?: number;
  clearHref: string;
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
        description="Select one or more options. Counts update as you refine."
        footer={
          <div className="flex items-center gap-3">
            {activeCount > 0 && (
              <Link
                href={clearHref}
                rel="nofollow"
                className={`${buttonClasses({ variant: "outline" })} shrink-0`}
              >
                Clear
              </Link>
            )}
            <Button fullWidth onClick={() => setOpen(false)}>
              {resultCount == null
                ? "Show results"
                : `Show ${resultCount.toLocaleString()} ${resultCount === 1 ? "result" : "results"}`}
            </Button>
          </div>
        }
      >
        {children}
      </Sheet>
    </>
  );
}
