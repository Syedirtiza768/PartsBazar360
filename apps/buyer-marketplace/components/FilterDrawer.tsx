"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SlidersIcon } from "@repo/ui/icons";
import { Button } from "@repo/ui/button";
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
}: {
  children: ReactNode;
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Close when any filter link navigates.
  useEffect(() => {
    setOpen(false);
  }, [pathname, searchParams]);

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
        title="Filters"
        footer={
          <Button fullWidth onClick={() => setOpen(false)}>
            Show results
          </Button>
        }
      >
        {children}
      </Sheet>
    </>
  );
}
