"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CarIcon,
  CartIcon,
  ChevronRightIcon,
  ClockIcon,
  HeartIcon,
  MenuIcon,
  SearchIcon,
  ShieldCheckIcon,
  UserIcon,
  XIcon,
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { useCart } from "@/lib/cart-context";
import { useGarage, vehicleShortLabel } from "@/lib/garage-context";
import { useWatchlist } from "@/lib/watchlist-context";
import { clearRecentSearches, getRecentSearches, pushRecentSearch } from "@/lib/recent";
import type { Facet } from "@/lib/types";

function SearchBox({ categories }: { categories: Facet[] }) {
  const router = useRouter();
  // The header renders one SearchBox per breakpoint — ids must stay unique
  // per instance or the second input loses its label association.
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setRecents(getRecentSearches());
  }, [open]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const submit = useCallback(
    (value: string, category?: string) => {
      const params = new URLSearchParams();
      const clean = value.trim();
      if (clean) {
        params.set("q", clean);
        pushRecentSearch(clean);
      }
      if (category) params.set("category", category);
      setOpen(false);
      router.push(`/search${params.size ? `?${params.toString()}` : ""}`);
    },
    [router],
  );

  const looksLikeNumber = /\d{3,}/.test(query) && query.trim().length > 4;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <form
        role="search"
        aria-label="Search all motor parts"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit(query);
        }}
        className="flex h-12 border-2 border-slate-950 bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-500"
      >
        <label htmlFor={searchId} className="sr-only">Search by part, brand, OE number or vehicle</label>
        <SearchIcon className="ml-4 mt-3.5 h-5 w-5 shrink-0 text-graphite-600" />
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Part, OE number, brand, or what you need fixed"
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[15px] font-medium text-slate-950 outline-none placeholder:font-normal placeholder:text-graphite-600"
        />
        <button className="m-1 min-w-20 bg-slate-950 px-4 text-sm font-black uppercase tracking-wide text-white transition-colors hover:bg-brand-700">
          Search
        </button>
      </form>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 border-2 border-slate-950 bg-white shadow-overlay">
          {query.trim() && (
            <button
              type="button"
              onClick={() => submit(query)}
              className="flex w-full items-center gap-3 border-b border-stone-200 px-4 py-3 text-left text-sm hover:bg-brand-50"
            >
              <SearchIcon className="h-4 w-4 text-brand-700" />
              <span>Search for <strong className="text-slate-950">{query.trim()}</strong></span>
              {looksLikeNumber && <span className="ml-auto text-xs font-semibold text-brand-700">Possible part number</span>}
            </button>
          )}
          <div className="grid sm:grid-cols-2">
            <section className="border-b border-stone-200 p-3 sm:border-b-0 sm:border-r" aria-label="Recent searches">
              <div className="flex items-center justify-between px-2 py-1">
                <p className="eyebrow">Recent searches</p>
                {recents.length > 0 && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-graphite-600 hover:text-slate-950"
                    onClick={() => {
                      clearRecentSearches();
                      setRecents([]);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {recents.length ? (
                recents.slice(0, 5).map((recent) => (
                  <button key={recent} type="button" onClick={() => submit(recent)} className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm text-slate-700 hover:bg-stone-100">
                    <ClockIcon className="h-4 w-4 text-slate-400" /> {recent}
                  </button>
                ))
              ) : (
                <p className="px-2 py-3 text-sm text-graphite-600">Your recent searches will appear here.</p>
              )}
            </section>
            <section className="p-3" aria-label="Popular categories">
              <p className="eyebrow px-2 py-1">Browse systems</p>
              {categories.slice(0, 6).map((category) => (
                <button key={category.name} type="button" onClick={() => submit("", category.name)} className="flex w-full items-center justify-between px-2 py-2 text-left text-sm text-slate-700 hover:bg-stone-100">
                  {category.name}
                  <ChevronRightIcon className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionLink({ href, label, icon, count, className }: { href: string; label: string; icon: React.ReactNode; count?: number; className?: string }) {
  return (
    <Link href={href} className={cn("relative flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-bold text-slate-700 hover:text-brand-700", className)}>
      {icon}
      <span className="hidden xl:block">{label}</span>
      {count ? <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center bg-signal-500 px-1 text-[10px] font-black text-graphite-950">{count > 99 ? "99+" : count}</span> : null}
    </Link>
  );
}

export function Header({ categories }: { categories: Facet[] }) {
  const pathname = usePathname();
  const { itemCount } = useCart();
  const { activeVehicle } = useGarage();
  const { count: watchCount } = useWatchlist();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  const categoryNames = categories.length
    ? categories.slice(0, 12).map((item) => item.name)
    : ["Engine", "Transmission", "Brakes", "Suspension", "Electrical", "Cooling", "Body", "Lighting"];
  const mobileLinks: Array<[string, string]> = [
    ["/", "Home"],
    ["/search", "Shop all parts"],
    ["/garage", "My garage"],
    ["/watchlist", "Watchlist"],
    ["/account/purchases", "Purchases"],
    ["/account/messages", "Messages"],
    ["/support", "Support"],
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-950 bg-white">
      <div className="bg-graphite-950 text-white">
        <div className="mx-auto flex h-8 max-w-[1440px] items-center justify-between px-4 text-[11px] font-semibold sm:px-6 lg:px-8">
          <p className="flex items-center gap-2"><ShieldCheckIcon className="h-3.5 w-3.5 text-brand-300" /> Fitment evidence shown on every listing</p>
          <nav className="hidden items-center gap-5 md:flex" aria-label="Utility navigation">
            <Link href="/account/purchases" className="hover:text-brand-200">Purchases</Link>
            <Link href="/account/messages" className="hover:text-brand-200">Messages</Link>
            <Link href="/support" className="hover:text-brand-200">Help</Link>
            <a href="/seller" className="hover:text-brand-200">Sell parts</a>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-[1440px] px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:gap-6">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="flex h-11 w-11 items-center justify-center border border-stone-300 text-slate-950 lg:hidden">
            <MenuIcon className="h-5 w-5" />
          </button>
          <Link href="/" className="shrink-0 leading-none" aria-label="PartsBazar360 home">
            <span className="block font-display text-xl font-black uppercase tracking-[-0.04em] text-slate-950 sm:text-2xl">PartsBazar</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.32em] text-brand-700">360 marketplace</span>
          </Link>
          <div className="hidden min-w-0 flex-1 md:block"><SearchBox categories={categories} /></div>
          <div className="ml-auto flex items-center gap-0.5">
            <ActionLink href="/watchlist" label="Watchlist" count={watchCount} icon={<HeartIcon className="h-5 w-5" />} className="hidden sm:flex" />
            <ActionLink href="/account" label="Account" icon={<UserIcon className="h-5 w-5" />} className="hidden sm:flex" />
            <ActionLink href="/cart" label="Cart" count={itemCount} icon={<CartIcon className="h-5 w-5" />} />
          </div>
        </div>
        <div className="mt-3 md:hidden"><SearchBox categories={categories} /></div>
      </div>

      <div className="border-t border-stone-200 bg-[#ebe8e1]">
        <div className="mx-auto flex max-w-[1440px] items-stretch px-4 sm:px-6 lg:px-8">
          <Link href="/garage" className="flex min-h-10 max-w-[50%] shrink-0 items-center gap-2 border-r border-stone-300 pr-4 text-xs font-bold text-slate-950 hover:text-brand-700 sm:max-w-none">
            <span className="flex h-full w-1 bg-signal-500" aria-hidden="true" />
            <CarIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{activeVehicle ? vehicleShortLabel(activeVehicle) : "Select a vehicle"}</span>
            <span className="hidden font-normal text-graphite-600 sm:inline">{activeVehicle ? "Change" : "Check fitment"}</span>
          </Link>
          <nav aria-label="Parts categories" className="scrollbar-thin flex min-w-0 flex-1 overflow-x-auto">
            {categoryNames.map((category) => (
              <Link key={category} href={`/search?category=${encodeURIComponent(category)}`} className="flex min-h-10 shrink-0 items-center border-r border-stone-300 px-4 text-xs font-bold text-slate-700 hover:bg-white hover:text-slate-950">
                {category}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-graphite-950/65" />
          <div className="absolute inset-y-0 left-0 flex w-[340px] max-w-[88vw] flex-col bg-[#f4f2ed] shadow-overlay">
            <div className="flex items-center justify-between border-b-2 border-slate-950 bg-white p-4">
              <p className="font-display text-xl font-black uppercase text-slate-950">PartsBazar360</p>
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" className="flex h-10 w-10 items-center justify-center border border-stone-300"><XIcon className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="eyebrow mb-2">Shop & account</p>
              {mobileLinks.map(([href, label]) => (
                <Link key={href} href={href} className="flex min-h-12 items-center justify-between border-b border-stone-300 text-sm font-bold text-slate-800">
                  {label}<ChevronRightIcon className="h-4 w-4 text-slate-400" />
                </Link>
              ))}
              <p className="eyebrow mb-2 mt-7">Parts systems</p>
              <div className="grid grid-cols-2 border-l border-t border-stone-300">
                {categoryNames.map((category) => (
                  <Link key={category} href={`/search?category=${encodeURIComponent(category)}`} className="border-b border-r border-stone-300 bg-white px-3 py-3 text-sm font-semibold text-slate-700">
                    {category}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
