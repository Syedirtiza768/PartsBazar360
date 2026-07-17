"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { cn } from "@repo/ui/cn";
import {
  SearchIcon,
  CartIcon,
  CarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MenuIcon,
  XIcon,
  ClockIcon,
  ShieldCheckIcon,
  PlusIcon,
} from "@repo/ui/icons";
import { useCart } from "@/lib/cart-context";
import {
  useGarage,
  vehicleShortLabel,
  vehicleFullLabel,
  type SavedVehicle,
} from "@/lib/garage-context";
import { getRecentSearches, pushRecentSearch, clearRecentSearches } from "@/lib/recent";
import type { Facet } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Search box with recent-searches dropdown                            */
/* ------------------------------------------------------------------ */

function SearchBox({ categories, compact = false }: { categories: Facet[]; compact?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setRecents(getRecentSearches());
  }, [open]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const submit = useCallback(
    (value: string) => {
      const q = value.trim();
      setOpen(false);
      if (q) pushRecentSearch(q);
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      router.push(`/search${params.size ? `?${params}` : ""}`);
    },
    [router],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(query);
  };

  const looksLikePartNumber = /^[A-Za-z0-9][A-Za-z0-9\-. ]{5,}$/.test(query.trim()) && /\d{3,}/.test(query);

  return (
    <div ref={rootRef} className="relative w-full">
      <form onSubmit={handleSubmit} role="search" aria-label="Search parts">
        <label htmlFor="site-search" className="sr-only">
          Search by part name, brand, or OE number
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
          <input
            id="site-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={compact ? "Search parts, OE numbers…" : "Search by part name, brand, or OE number…"}
            className={cn(
              "w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-20 text-sm text-slate-900",
              "placeholder:text-slate-400 transition-colors",
              "hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/60",
            )}
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-md bg-brand-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
          >
            Search
          </button>
        </div>
      </form>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-overlay animate-fade-in">
          {looksLikePartNumber && (
            <button
              type="button"
              onClick={() => submit(query)}
              className="flex w-full items-center gap-2.5 border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-brand-50"
            >
              <SearchIcon className="h-4 w-4 shrink-0 text-brand-600" />
              <span>
                Search OE / part number <span className="part-number font-semibold text-slate-900">{query.trim()}</span>
              </span>
            </button>
          )}

          {recents.length > 0 && (
            <div className="border-b border-slate-100 py-2">
              <div className="flex items-center justify-between px-4 py-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent searches</p>
                <button
                  type="button"
                  onClick={() => {
                    clearRecentSearches();
                    setRecents([]);
                  }}
                  className="text-xs font-medium text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              </div>
              <ul>
                {recents.slice(0, 5).map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onClick={() => submit(r)}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <ClockIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="truncate">{r}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {categories.length > 0 && (
            <div className="py-2">
              <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Browse categories
              </p>
              <div className="flex flex-wrap gap-1.5 px-4 pb-2 pt-1">
                {categories.slice(0, 8).map((c) => (
                  <Link
                    key={c.name}
                    href={`/search?category=${encodeURIComponent(c.name)}`}
                    onClick={() => setOpen(false)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <p className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
            Tip: OE numbers (e.g. <span className="part-number">51459173904</span>) give the most exact matches.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Garage chip — persistent active-vehicle context                     */
/* ------------------------------------------------------------------ */

function GarageChip() {
  const { vehicles, activeVehicle, ready, setActive } = useGarage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!ready) {
    return <div className="h-10 w-32 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />;
  }

  if (!activeVehicle) {
    return (
      <Link
        href="/garage"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
      >
        <CarIcon className="h-[18px] w-[18px]" />
        <span className="hidden lg:inline">Select vehicle</span>
        <span className="lg:hidden">Vehicle</span>
      </Link>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          "inline-flex h-10 max-w-[240px] items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
          "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 hover:bg-amber-100",
        )}
      >
        <CarIcon className="h-[18px] w-[18px] shrink-0 text-amber-700" />
        <span className="truncate">{vehicleShortLabel(activeVehicle)}</span>
        <ChevronDownIcon className={cn("h-4 w-4 shrink-0 text-amber-700 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-overlay animate-fade-in">
          <div className="border-b border-slate-100 bg-amber-50/60 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
              <ShieldCheckIcon className="h-3.5 w-3.5" /> Shopping for
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{vehicleFullLabel(activeVehicle)}</p>
            {activeVehicle.vin && (
              <p className="part-number mt-0.5 text-slate-500">VIN {activeVehicle.vin}</p>
            )}
            <Link
              href={`/search?vehicleConfigId=${activeVehicle.configId}`}
              onClick={() => setOpen(false)}
              className="mt-2.5 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              Shop verified-fit parts <ChevronRightIcon className="h-4 w-4" />
            </Link>
          </div>

          {vehicles.length > 1 && (
            <ul className="max-h-56 overflow-y-auto py-1.5 scrollbar-thin" aria-label="Switch vehicle">
              {vehicles
                .filter((v) => v.id !== activeVehicle.id)
                .map((v: SavedVehicle) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActive(v.id);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <CarIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{vehicleShortLabel(v)}</span>
                        <span className="block truncate text-xs text-slate-500">{v.generationName}</span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
            <Link
              href="/garage"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <PlusIcon className="h-4 w-4" /> Manage garage
            </Link>
            <button
              type="button"
              onClick={() => {
                setActive(null);
                setOpen(false);
                router.refresh();
              }}
              className="text-sm font-medium text-slate-400 hover:text-slate-600"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function Header({ categories = [] }: { categories?: Facet[] }) {
  const { itemCount } = useCart();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const navCategories = categories.slice(0, 7);

  return (
    <header className="sticky top-0 z-50 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      {/* Utility bar */}
      <div className="hidden bg-graphite-950 text-xs text-slate-300 sm:block">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <p className="flex items-center gap-1.5">
            <ShieldCheckIcon className="h-3.5 w-3.5 text-emerald-400" />
            Fitment-verified parts from 11 vetted sellers · Worldwide shipping
          </p>
          <nav aria-label="Utility" className="flex items-center gap-5">
            <Link href="/support" className="transition-colors hover:text-white">
              Support
            </Link>
            <Link href="/garage" className="transition-colors hover:text-white">
              My Garage
            </Link>
          </nav>
        </div>
      </div>

      {/* Main bar */}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          className="-ml-1 rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 md:hidden"
        >
          <MenuIcon className="h-5 w-5" />
        </button>

        <Link href="/" className="shrink-0 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
          PartsBazar<span className="text-brand-600">360</span>
        </Link>

        <div className="hidden min-w-0 flex-1 md:block md:px-2 lg:px-6">
          <SearchBox categories={categories} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden md:block">
            <GarageChip />
          </div>
          <Link
            href="/cart"
            aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            className="relative inline-flex h-10 items-center gap-2 rounded-lg bg-graphite-950 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-graphite-900"
          >
            <CartIcon className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">Cart</span>
            {itemCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Mobile search row */}
      <div className="border-t border-slate-100 px-4 pb-3 pt-2 md:hidden">
        <SearchBox categories={categories} compact />
      </div>

      {/* Category rail (desktop) */}
      <nav aria-label="Categories" className="hidden border-t border-slate-100 md:block">
        <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-1.5 scrollbar-thin sm:px-6 lg:px-8">
          <Link
            href="/search"
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
              pathname === "/search"
                ? "bg-brand-50 text-brand-700"
                : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            All parts
          </Link>
          {navCategories.map((c) => (
            <Link
              key={c.name}
              href={`/search?category=${encodeURIComponent(c.name)}`}
              className="shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {c.name}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-slate-200" aria-hidden="true" />
          <Link
            href="/garage"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-amber-800 transition-colors hover:bg-amber-50"
          >
            <CarIcon className="h-4 w-4" />
            Find by vehicle
          </Link>
        </div>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-graphite-950/50 backdrop-blur-[2px] animate-fade-in"
          />
          <div className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-overlay animate-slide-in-left">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <p className="text-lg font-black tracking-tight text-slate-900">
                PartsBazar<span className="text-brand-600">360</span>
              </p>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4">
              <div className="px-2 pb-3">
                <GarageChip />
              </div>
              <nav aria-label="Main" className="space-y-0.5">
                {[
                  { href: "/", label: "Home" },
                  { href: "/search", label: "Shop all parts" },
                  { href: "/garage", label: "My Garage" },
                  { href: "/cart", label: "Cart" },
                  { href: "/support", label: "Support" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors",
                      pathname === item.href
                        ? "bg-brand-50 text-brand-700"
                        : "text-slate-700 hover:bg-slate-50",
                    )}
                    aria-current={pathname === item.href ? "page" : undefined}
                  >
                    {item.label}
                    <ChevronRightIcon className="h-4 w-4 text-slate-300" />
                  </Link>
                ))}
              </nav>

              {navCategories.length > 0 && (
                <>
                  <p className="mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Categories
                  </p>
                  <nav aria-label="Categories" className="mt-1.5 space-y-0.5">
                    {navCategories.map((c) => (
                      <Link
                        key={c.name}
                        href={`/search?category=${encodeURIComponent(c.name)}`}
                        className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                      >
                        {c.name}
                        <span className="text-xs text-slate-400">{c.count.toLocaleString()}</span>
                      </Link>
                    ))}
                  </nav>
                </>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4">
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheckIcon className="h-4 w-4 text-emerald-500" />
                Fitment-verified parts · 11 vetted sellers
              </p>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
