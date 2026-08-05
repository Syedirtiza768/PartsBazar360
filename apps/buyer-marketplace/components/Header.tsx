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
  PackageIcon,
  SearchIcon,
  ShieldCheckIcon,
  TagIcon,
  UserIcon,
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { Sheet } from "@repo/ui/sheet";
import { Spinner } from "@repo/ui/spinner";
import { useCart } from "@/lib/cart-context";
import { useGarage, vehicleShortLabel } from "@/lib/garage-context";
import { useWatchlist } from "@/lib/watchlist-context";
import { useAuth } from "@/lib/auth-context";
import { clearRecentSearches, getRecentSearches, pushRecentSearch } from "@/lib/recent";
import { useSearchSuggestions } from "@/lib/use-search-suggestions";
import { useCurrency } from "@/lib/currency-context";
import { CurrencySwitcher } from "@/components/CurrencySwitcher";
import type { Facet } from "@/lib/types";

const IMG_PROXY = process.env.NEXT_PUBLIC_IMG_PROXY_BASE || "/img-proxy/";

function thumbUrl(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    const url = src.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, "/s-l120.$1");
    return `${IMG_PROXY}?url=${url}`;
  }
  return src;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, q }: { text: string; q: string }) {
  const trimmed = q.trim();
  if (!trimmed) return <>{text}</>;
  const regex = new RegExp(`(${escapeRegex(trimmed)})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <strong key={i} className="font-bold text-graphite-950">{part}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function SearchBox({ categories }: { categories: Facet[] }) {
  const router = useRouter();
  const searchId = useId();
  const { format } = useCurrency();
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const {
    query,
    setQuery,
    results,
    loading,
    activeIndex,
    setActiveIndex,
    moveUp,
    moveDown,
    reset,
  } = useSearchSuggestions();

  useEffect(() => {
    if (open) setRecents(getRecentSearches());
  }, [open]);

  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        reset();
      }
    };
    document.addEventListener("pointerdown", handlePointer);
    return () => document.removeEventListener("pointerdown", handlePointer);
  }, [reset]);

  const submit = useCallback(
    (
      value: string,
      category?: string,
      brand?: string,
      categoryGroup?: string,
      make?: string,
      sourceTag?: string,
    ) => {
      const params = new URLSearchParams();
      const clean = value.trim();
      if (clean) {
        params.set("q", clean);
        pushRecentSearch(clean);
      }
      if (category) params.set("category", category);
      if (categoryGroup) params.set("categoryGroup", categoryGroup);
      if (brand) params.set("brand", brand);
      if (make) params.set("make", make);
      if (sourceTag) params.set("sourceTag", sourceTag);
      setOpen(false);
      reset();
      setQuery("");
      router.push(`/search${params.size ? `?${params.toString()}` : ""}`);
    },
    [router, reset, setQuery],
  );

  const navigateToPart = useCallback(
    (id: string) => {
      setOpen(false);
      reset();
      setQuery("");
      router.push(`/part/${id}`);
    },
    [router, reset, setQuery],
  );

  const hasQuery = query.trim().length >= 2;
  const showSuggestions = hasQuery && results;
  const looksLikeNumber = /\d{3,}/.test(query) && query.trim().length > 4;

  // Flat keyboard-navigation index boundaries
  const searchActionEnd = hasQuery ? 1 : 0;
  const partsEnd = searchActionEnd + (results?.parts.length ?? 0);
  const suggestGroupEnd = partsEnd + (results?.categoryGroups.length ?? 0);
  const suggestCatEnd = suggestGroupEnd + (results?.categories.length ?? 0);
  const suggestBrandEnd = suggestCatEnd + (results?.brands.length ?? 0);
  const suggestMakeEnd = suggestBrandEnd + (results?.makes.length ?? 0);
  const suggestTagEnd = suggestMakeEnd + (results?.sourceTags.length ?? 0);
  const recentsStart = suggestTagEnd;
  const recentsEnd = recentsStart + Math.min(recents.length, 5);
  const totalNav = recentsEnd;

  const activateItem = useCallback(
    (index: number) => {
      if (index === 0 && hasQuery) {
        submit(query);
        return;
      }
      if (index < partsEnd && results) {
        const part = results.parts[index - searchActionEnd];
        if (part) navigateToPart(part.id);
        return;
      }
      if (index < suggestGroupEnd && results) {
        const categoryGroup = results.categoryGroups[index - partsEnd];
        if (categoryGroup) submit("", undefined, undefined, categoryGroup);
        return;
      }
      if (index < suggestCatEnd && results) {
        const cat = results.categories[index - suggestGroupEnd];
        if (cat) submit("", cat);
        return;
      }
      if (index < suggestBrandEnd && results) {
        const brand = results.brands[index - suggestCatEnd];
        if (brand) submit("", undefined, brand);
        return;
      }
      if (index < suggestMakeEnd && results) {
        const make = results.makes[index - suggestBrandEnd];
        if (make) submit("", undefined, undefined, undefined, make);
        return;
      }
      if (index < suggestTagEnd && results) {
        const sourceTag = results.sourceTags[index - suggestMakeEnd];
        if (sourceTag) submit("", undefined, undefined, undefined, undefined, sourceTag);
        return;
      }
      if (index < recentsEnd) {
        const recent = recents[index - recentsStart];
        if (recent) submit(recent);
      }
    },
    [hasQuery, query, results, recents, submit, navigateToPart, searchActionEnd, partsEnd, suggestCatEnd, suggestGroupEnd, suggestBrandEnd, suggestMakeEnd, suggestTagEnd, recentsStart, recentsEnd],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          setOpen(true);
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (totalNav > 0) moveDown();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (totalNav > 0) moveUp();
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        activateItem(activeIndex);
      } else if (e.key === "Escape") {
        setOpen(false);
        reset();
      }
    },
    [open, activeIndex, totalNav, moveUp, moveDown, activateItem, reset],
  );

  // Scroll active keyboard item into view
  useEffect(() => {
    if (activeIndex < 0 || !open) return;
    const el = listRef.current?.querySelector(`[data-aidx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const itemBase =
    "flex min-h-touch w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors";

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <form
        role="search"
        aria-label="Search all motor parts"
        aria-haspopup="listbox"
        aria-expanded={open}
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
          ref={inputRef}
          id={searchId}
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="search-listbox"
          aria-activedescendant={activeIndex >= 0 ? `search-opt-${activeIndex}` : undefined}
          aria-expanded={open}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Part, OE number, or brand"
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-base font-medium text-graphite-950 outline-none placeholder:font-normal placeholder:text-graphite-600 sm:px-3 sm:text-[15px]"
        />
        {loading && hasQuery && (
          <Spinner className="h-4 w-4 mr-1 shrink-0" />
        )}
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
        <div
          ref={listRef}
          id="search-listbox"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-dropdown mt-2 max-h-[min(32rem,65dvh)] overflow-y-auto overscroll-none-y border-2 border-graphite-950 bg-white shadow-overlay"
        >
          {/* Full-text search action */}
          {hasQuery && (
            <button
              id="search-opt-0"
              role="option"
              aria-selected={activeIndex === 0}
              data-aidx={0}
              type="button"
              onClick={() => submit(query)}
              onMouseEnter={() => setActiveIndex(0)}
              className={`${itemBase} border-b border-stone-200 hover:bg-brand-50 ${activeIndex === 0 ? "bg-brand-50" : ""}`}
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

          {/* Parts suggestions */}
          {showSuggestions && results.parts.length > 0 && (
            <section aria-label="Matching parts" className="border-b border-stone-200">
              <p className="eyebrow px-4 pt-3 pb-1.5">Parts</p>
              {results.parts.map((part, i) => {
                const idx = searchActionEnd + i;
                return (
                  <button
                    id={`search-opt-${idx}`}
                    role="option"
                    aria-selected={activeIndex === idx}
                    key={part.id}
                    data-aidx={idx}
                    type="button"
                    onClick={() => navigateToPart(part.id)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`${itemBase} gap-3 hover:bg-stone-50 ${activeIndex === idx ? "bg-stone-50" : ""}`}
                  >
                    {part.imageUrl ? (
                      <img
                        src={thumbUrl(part.imageUrl)}
                        alt=""
                        aria-hidden="true"
                        className="h-10 w-10 shrink-0 rounded border border-stone-200 object-contain bg-[#f7f6f2]"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-stone-200 bg-slate-50">
                        <PackageIcon className="h-5 w-5 text-slate-300" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-graphite-950">
                        <Highlight text={part.title} q={query} />
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-graphite-600">
                        {part.brand && (
                          <span>
                            <Highlight text={part.brand} q={query} />
                          </span>
                        )}
                        {part.category && <span>{part.category}</span>}
                        {part.manufacturerPartNumber && (
                          <span className="part-number">
                            <Highlight text={part.manufacturerPartNumber} q={query} />
                          </span>
                        )}
                      </span>
                    </span>
                    {part.minPrice != null && (
                      <span className="shrink-0 text-sm font-bold text-graphite-950">
                        {format(part.minPrice, part.currency)}
                      </span>
                    )}
                  </button>
                );
              })}
              {results.parts.length >= 6 && (
                <button
                  type="button"
                  onClick={() => submit(query)}
                  className="flex min-h-touch w-full items-center justify-center gap-1.5 border-t border-stone-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-700 hover:bg-brand-50"
                >
                  See all results
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </section>
          )}

          {/* Suggested filters */}
          {showSuggestions &&
            (results.categories.length > 0 ||
              results.categoryGroups.length > 0 ||
              results.brands.length > 0 ||
              results.makes.length > 0 ||
              results.sourceTags.length > 0) && (
              <section className="border-b border-stone-200">
                <div className="grid sm:grid-cols-2">
                  {results.categoryGroups.length > 0 && (
                    <div className="border-b border-stone-200 p-3 sm:border-r">
                      <p className="eyebrow px-2 py-1">Category</p>
                      {results.categoryGroups.map((categoryGroup, i) => {
                        const idx = partsEnd + i;
                        return (
                          <button
                            id={`search-opt-${idx}`}
                            role="option"
                            aria-selected={activeIndex === idx}
                            key={categoryGroup}
                            data-aidx={idx}
                            type="button"
                            onClick={() => submit("", undefined, undefined, categoryGroup)}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={`${itemBase} px-2 hover:bg-stone-100 ${activeIndex === idx ? "bg-stone-100" : ""}`}
                          >
                            <TagIcon className="h-4 w-4 shrink-0 text-brand-700" />
                            <span className="min-w-0 truncate">
                              <Highlight text={categoryGroup} q={query} />
                            </span>
                            <ChevronRightIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {results.categories.length > 0 && (
                    <div className="border-b border-stone-200 p-3 sm:border-b-0 sm:border-r">
                      <p className="eyebrow px-2 py-1">Part Category</p>
                      {results.categories.map((cat, i) => {
                        const idx = suggestGroupEnd + i;
                        return (
                          <button
                            id={`search-opt-${idx}`}
                            role="option"
                            aria-selected={activeIndex === idx}
                            key={cat}
                            data-aidx={idx}
                            type="button"
                            onClick={() => submit("", cat)}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={`${itemBase} px-2 hover:bg-stone-100 ${activeIndex === idx ? "bg-stone-100" : ""}`}
                          >
                            <TagIcon className="h-4 w-4 shrink-0 text-brand-700" />
                            <span className="min-w-0 truncate">
                              <Highlight text={cat} q={query} />
                            </span>
                            <ChevronRightIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {results.brands.length > 0 && (
                    <div className="border-b border-stone-200 p-3">
                      <p className="eyebrow px-2 py-1">Brand / Manufacturer</p>
                      {results.brands.map((brand, i) => {
                        const idx = suggestCatEnd + i;
                        return (
                          <button
                            id={`search-opt-${idx}`}
                            role="option"
                            aria-selected={activeIndex === idx}
                            key={brand}
                            data-aidx={idx}
                            type="button"
                            onClick={() => submit("", undefined, brand)}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={`${itemBase} px-2 hover:bg-stone-100 ${activeIndex === idx ? "bg-stone-100" : ""}`}
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-graphite-950 text-[9px] font-black text-white">
                              {brand.charAt(0)}
                            </span>
                            <span className="min-w-0 truncate">
                              <Highlight text={brand} q={query} />
                            </span>
                            <ChevronRightIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {results.makes.length > 0 && (
                    <div className="border-b border-stone-200 p-3 sm:border-r">
                      <p className="eyebrow px-2 py-1">Fits Vehicle Make</p>
                      {results.makes.map((make, i) => {
                        const idx = suggestBrandEnd + i;
                        return (
                          <button
                            id={`search-opt-${idx}`}
                            role="option"
                            aria-selected={activeIndex === idx}
                            key={make}
                            data-aidx={idx}
                            type="button"
                            onClick={() => submit("", undefined, undefined, undefined, make)}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={`${itemBase} px-2 hover:bg-stone-100 ${activeIndex === idx ? "bg-stone-100" : ""}`}
                          >
                            <CarIcon className="h-4 w-4 shrink-0 text-brand-700" />
                            <span className="min-w-0 truncate">
                              <Highlight text={make} q={query} />
                            </span>
                            <ChevronRightIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {results.sourceTags.length > 0 && (
                    <div className="p-3">
                      <p className="eyebrow px-2 py-1">Inventory Tag</p>
                      {results.sourceTags.map((sourceTag, i) => {
                        const idx = suggestMakeEnd + i;
                        return (
                          <button
                            id={`search-opt-${idx}`}
                            role="option"
                            aria-selected={activeIndex === idx}
                            key={sourceTag}
                            data-aidx={idx}
                            type="button"
                            onClick={() => submit("", undefined, undefined, undefined, undefined, sourceTag)}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={`${itemBase} px-2 hover:bg-stone-100 ${activeIndex === idx ? "bg-stone-100" : ""}`}
                          >
                            <TagIcon className="h-4 w-4 shrink-0 text-brand-700" />
                            <span className="min-w-0 truncate">{sourceTag}</span>
                            <ChevronRightIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}

          {/* Recent searches */}
          {recents.length > 0 && (
            <section aria-label="Recent searches" className="p-3">
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <p className="eyebrow">Recent searches</p>
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
              </div>
              {recents.slice(0, 5).map((recent, i) => {
                const idx = recentsStart + i;
                return (
                  <button
                    id={`search-opt-${idx}`}
                    role="option"
                    aria-selected={activeIndex === idx}
                    key={recent}
                    data-aidx={idx}
                    type="button"
                    onClick={() => submit(recent)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`${itemBase} px-2 hover:bg-stone-100 ${activeIndex === idx ? "bg-stone-100" : ""}`}
                  >
                    <ClockIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 truncate">{recent}</span>
                  </button>
                );
              })}
            </section>
          )}

          {/* Empty state: no query and no recents — show category browse */}
          {!hasQuery && recents.length === 0 && (
            <div className="grid sm:grid-cols-2">
              <section className="border-b border-stone-200 p-3 sm:border-b-0 sm:border-r" aria-label="Recent searches">
                <p className="eyebrow px-2 py-1">Recent searches</p>
                <p className="px-2 py-3 text-sm text-graphite-600">
                  Your recent searches will appear here.
                </p>
              </section>
              <section className="p-3" aria-label="Popular categories">
                <p className="eyebrow px-2 py-1">Browse systems</p>
                {categories.slice(0, 6).map((category) => (
                  <button
                    key={category.name}
                    type="button"
                    onClick={() => submit("", undefined, undefined, category.name)}
                    className="flex min-h-touch w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm text-graphite-700 hover:bg-stone-100"
                  >
                    <span className="min-w-0 truncate">{category.name}</span>
                    <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                ))}
              </section>
            </div>
          )}

          {/* No results state */}
          {hasQuery && !loading && results && results.parts.length === 0 && results.categories.length === 0 && results.categoryGroups.length === 0 && results.brands.length === 0 && results.makes.length === 0 && results.sourceTags.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm font-semibold text-graphite-950">No suggestions for &ldquo;{query.trim()}&rdquo;</p>
              <p className="mt-1 text-xs text-graphite-600">
                Try a different keyword, part number, or brand name.
              </p>
            </div>
          )}

          {/* Keyboard hint */}
          {hasQuery && totalNav > 0 && (
            <div className="hidden sm:flex items-center gap-3 border-t border-stone-100 px-4 py-1.5 text-[10px] text-graphite-600">
              <span><kbd className="rounded border border-stone-300 px-1 py-0.5 font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="rounded border border-stone-300 px-1 py-0.5 font-mono">↵</kbd> select</span>
              <span><kbd className="rounded border border-stone-300 px-1 py-0.5 font-mono">esc</kbd> close</span>
            </div>
          )}
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
              <CurrencySwitcher compact />
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
                href={`/search?categoryGroup=${encodeURIComponent(category)}`}
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
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-stone-300 bg-white px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-graphite-600">Display currency</p>
              <p className="mt-0.5 text-[11px] text-graphite-600">Stripe settles to AED</p>
            </div>
            <CurrencySwitcher />
          </div>
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
                href={`/search?categoryGroup=${encodeURIComponent(category)}`}
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
