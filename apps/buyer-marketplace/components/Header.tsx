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
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { Sheet } from "@repo/ui/sheet";
import { useCart } from "@/lib/cart-context";
import { useGarage, vehicleShortLabel } from "@/lib/garage-context";
import { useWatchlist } from "@/lib/watchlist-context";
import { useAuth } from "@/lib/auth-context";
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
        className="flex h-12 items-center border-2 border-graphite-950 bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-500"
      >
        <label htmlFor={searchId} className="sr-only">
          Search by part, brand, OE number or vehicle
        </label>
        <SearchIcon className="ml-3 h-5 w-5 shrink-0 text-graphite-600 sm:ml-4" />
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          // Placeholder shortens on narrow screens: the long copy was clipped
          // mid-word at 320px and read as broken rather than helpful.
          placeholder="Part, OE number, or brand"
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-base font-medium text-graphite-950 outline-none placeholder:font-normal placeholder:text-graphite-600 sm:px-3 sm:text-[15px]"
        />
        <button
          type="submit"
          aria-label="Search"
          className="m-1 flex h-10 shrink-0 items-center justify-center bg-graphite-950 px-3 text-sm font-black uppercase tracking-wide text-white transition-colors hover:bg-brand-700 sm:min-w-20 sm:px-4"
        >
          <SearchIcon className="h-5 w-5 xs:hidden" />
          <span className="hidden xs:inline">Search</span>
        </button>
      </form>

      {open && (
        /*
          Capped against the dynamic viewport and scrollable: with a long
          recents list this panel used to run past the bottom of a landscape
          phone with no way to reach the last entries.
        */
        <div className="absolute inset-x-0 top-full z-dropdown mt-2 max-h-[min(28rem,60dvh)] overflow-y-auto overscroll-none-y border-2 border-graphite-950 bg-white shadow-overlay">
          {query.trim() && (
            <button
              type="button"
              onClick={() => submit(query)}
              className="flex min-h-touch w-full items-center gap-3 border-b border-stone-200 px-4 py-3 text-left text-sm hover:bg-brand-50"
            >
              <SearchIcon className="h-4 w-4 shrink-0 text-brand-700" />
              <span className="min-w-0 break-anywhere">
                Search for <strong className="text-graphite-950">{query.trim()}</strong>
              </span>
              {looksLikeNumber && (
                <span className="ml-auto shrink-0 text-xs font-semibold text-brand-700">
                  Possible part number
                </span>
              )}
            </button>
          )}
          <div className="grid sm:grid-cols-2">
            <section className="border-b border-stone-200 p-3 sm:border-b-0 sm:border-r" aria-label="Recent searches">
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <p className="eyebrow">Recent searches</p>
                {recents.length > 0 && (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold text-graphite-600 hover:text-graphite-950"
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
                  <button
                    key={recent}
                    type="button"
                    onClick={() => submit(recent)}
                    className="flex min-h-touch w-full items-center gap-2 px-2 py-2 text-left text-sm text-graphite-700 hover:bg-stone-100"
                  >
                    <ClockIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 truncate">{recent}</span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-3 text-sm text-graphite-600">
                  Your recent searches will appear here.
                </p>
              )}
            </section>
            <section className="p-3" aria-label="Popular categories">
              <p className="eyebrow px-2 py-1">Browse systems</p>
              {categories.slice(0, 6).map((category) => (
                <button
                  key={category.name}
                  type="button"
                  onClick={() => submit("", category.name)}
                  className="flex min-h-touch w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm text-graphite-700 hover:bg-stone-100"
                >
                  <span className="min-w-0 truncate">{category.name}</span>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionLink({
  href,
  label,
  icon,
  count,
  className,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-touch min-w-touch flex-col items-center justify-center gap-0.5 px-1.5 text-[11px] font-bold text-graphite-700 hover:text-brand-700 sm:px-2",
        className,
      )}
    >
      {icon}
      <span className="hidden xl:block">{label}</span>
      {count ? (
        <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center bg-signal-500 px-1 text-[10px] font-black text-graphite-950">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
      <span className="sr-only xl:hidden">{label}</span>
    </Link>
  );
}

export function Header({ categories }: { categories: Facet[] }) {
  const pathname = usePathname();
  const { itemCount } = useCart();
  const { activeVehicle } = useGarage();
  const { count: watchCount } = useWatchlist();
  const { user, ready: authReady, isAuthenticated, logout } = useAuth();
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
    ...(isAuthenticated
      ? ([["/account", "Account"]] as Array<[string, string]>)
      : ([
          ["/login", "Sign in"],
          ["/signup", "Create account"],
        ] as Array<[string, string]>)),
  ];

  return (
    <>
      {/*
        Only the utility strip and the main bar are sticky. The category rail
        below used to be sticky too, which pinned ~196px of chrome — a third of
        a 320×568 viewport — to the top of every page on a phone. It now scrolls
        away with the page, and every destination in it is still one tap away
        from the menu.
      */}
      <header className="sticky top-0 z-header border-b border-graphite-950 bg-white pt-safe">
        <div className="hidden bg-graphite-950 text-white md:block">
          <div className="mx-auto flex h-8 max-w-wide items-center justify-between gutter text-[11px] font-semibold">
            <p className="flex items-center gap-2">
              <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-brand-300" />
              Fitment evidence shown on every listing
            </p>
            <nav className="flex items-center gap-5" aria-label="Utility navigation">
              <Link href="/account/purchases" className="hover:text-brand-200">Purchases</Link>
              <Link href="/account/messages" className="hover:text-brand-200">Messages</Link>
              <Link href="/support" className="hover:text-brand-200">Help</Link>
              {authReady && isAuthenticated ? (
                <button type="button" onClick={logout} className="hover:text-brand-200">
                  Sign out
                </button>
              ) : (
                <Link href="/login" className="hover:text-brand-200">Sign in</Link>
              )}
              <a href="/seller" className="hover:text-brand-200">Sell parts</a>
            </nav>
          </div>
        </div>

        <div className="mx-auto max-w-wide gutter py-2.5 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3 lg:gap-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              className="flex touch-target shrink-0 items-center justify-center border border-stone-300 text-graphite-950 lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <Link href="/" className="flex min-h-touch min-w-0 shrink-0 flex-col justify-center leading-none" aria-label="PartsBazar360 home">
              <span className="block font-display text-lg font-black uppercase tracking-[-0.04em] text-graphite-950 xs:text-xl sm:text-2xl">
                PartsBazar
              </span>
              <span className="block text-[9px] font-black uppercase tracking-[0.28em] text-brand-700 xs:text-[10px] xs:tracking-[0.32em]">
                360 marketplace
              </span>
            </Link>
            <div className="hidden min-w-0 flex-1 md:block">
              <SearchBox categories={categories} />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <ActionLink
                href="/watchlist"
                label="Watchlist"
                count={watchCount}
                icon={<HeartIcon className="h-5 w-5" />}
                className="hidden sm:flex"
              />
              <ActionLink
                href={isAuthenticated ? "/account" : "/login"}
                label={authReady && isAuthenticated ? user?.name?.split(" ")[0] || "Account" : "Sign in"}
                icon={<UserIcon className="h-5 w-5" />}
                className="hidden sm:flex"
              />
              <ActionLink href="/cart" label="Cart" count={itemCount} icon={<CartIcon className="h-5 w-5" />} />
            </div>
          </div>
          <div className="mt-2.5 md:hidden">
            <SearchBox categories={categories} />
          </div>
        </div>
      </header>

      <div className="border-b border-stone-200 bg-canvas-sunk">
        <div className="mx-auto flex max-w-wide items-stretch gutter">
          <Link
            href="/garage"
            className="flex min-h-11 max-w-[55%] shrink-0 items-center gap-2 border-r border-stone-300 pr-3 text-xs font-bold text-graphite-950 hover:text-brand-700 sm:max-w-none sm:pr-4"
          >
            <span className="flex h-full w-1 shrink-0 bg-signal-500" aria-hidden="true" />
            <CarIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {activeVehicle ? vehicleShortLabel(activeVehicle) : "Select a vehicle"}
            </span>
            <span className="hidden shrink-0 font-normal text-graphite-600 sm:inline">
              {activeVehicle ? "Change" : "Check fitment"}
            </span>
          </Link>
          <nav aria-label="Parts categories" className="scroll-rail min-w-0 flex-1">
            {categoryNames.map((category) => (
              <Link
                key={category}
                href={`/search?category=${encodeURIComponent(category)}`}
                className="flex min-h-11 shrink-0 items-center border-r border-stone-300 px-3.5 text-xs font-bold text-graphite-700 hover:bg-white hover:text-graphite-950 sm:px-4"
              >
                {category}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <Sheet
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        side="left"
        size="md"
        title="Menu"
        hideTitle
        className="bg-canvas"
        bodyClassName="px-0 py-0"
      >
        <div className="border-b-2 border-graphite-950 bg-white px-4 py-4">
          <p className="font-display text-xl font-black uppercase text-graphite-950">PartsBazar360</p>
        </div>
        <div className="px-4 py-4">
          <p className="eyebrow mb-2">Shop &amp; account</p>
          {mobileLinks.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="flex min-h-12 items-center justify-between gap-3 border-b border-stone-300 text-sm font-bold text-slate-800"
            >
              {label}
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
            </Link>
          ))}
          {authReady && isAuthenticated && (
            <button
              type="button"
              onClick={logout}
              className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-stone-300 text-left text-sm font-bold text-slate-800"
            >
              Sign out
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          )}
          <a
            href="/seller"
            className="flex min-h-12 items-center justify-between gap-3 border-b border-stone-300 text-sm font-bold text-slate-800"
          >
            Sell parts
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
          </a>

          <p className="eyebrow mb-2 mt-7">Parts systems</p>
          <div className="grid grid-cols-2 border-l border-t border-stone-300">
            {categoryNames.map((category) => (
              <Link
                key={category}
                href={`/search?category=${encodeURIComponent(category)}`}
                className="flex min-h-touch items-center border-b border-r border-stone-300 bg-white px-3 py-3 text-sm font-semibold text-graphite-700"
              >
                {category}
              </Link>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  );
}
