"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SlidersIcon } from "@repo/ui/icons";
import { Button, buttonClasses } from "@repo/ui/button";
import { Sheet } from "@repo/ui/sheet";

const DRAWER_KEY = "pb360:filterDrawer";

/**
 * Mobile filter experience: a trigger button + full-height drawer. The filter
 * links themselves are server-rendered and passed in as children, so the
 * drawer is just presentation.
 *
 * Intercepts filter-link clicks inside the drawer so the buyer can tick
 * multiple checkboxes without the sheet closing on every selection. The
 * drawer re-opens automatically after each SSR navigation via sessionStorage.
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
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Re-open the drawer after SSR navigation replaces the component tree.
  // The loading boundary unmounts us; sessionStorage bridges the gap.
  useEffect(() => {
    if (sessionStorage.getItem(DRAWER_KEY) === "1") {
      setOpen(true);
      sessionStorage.removeItem(DRAWER_KEY);
    }
  }, []);

  // Persist open state so it survives the loading boundary unmount.
  useEffect(() => {
    if (open) {
      sessionStorage.setItem(DRAWER_KEY, "1");
    } else {
      sessionStorage.removeItem(DRAWER_KEY);
    }
  }, [open]);

  // Intercept filter-link clicks so the drawer stays open while the URL
  // updates. Only targets <a> elements whose href starts with /search —
  // the "Clear" link in the footer and the close button are outside the
  // intercepted zone.
  const handleFilterClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest(
        'a[href^="/search"]',
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      e.preventDefault();
      // Persist before navigation so the re-mounted drawer knows to open.
      sessionStorage.setItem(DRAWER_KEY, "1");
      router.push(anchor.href);
    },
    [router],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

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
        onClose={handleClose}
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
                onClick={() => setOpen(false)}
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
        {/* Intercept filter clicks so multi-select doesn't close the drawer */}
        <div onClick={handleFilterClick}>{children}</div>
      </Sheet>
    </>
  );
}
