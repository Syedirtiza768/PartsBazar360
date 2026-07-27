"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChevronRightIcon,
  ClockIcon,
  PackageIcon,
  SearchIcon,
  TagIcon,
} from "@repo/ui/icons";
import { Spinner } from "@repo/ui/spinner";
import { pushRecentSearch, getRecentSearches } from "@/lib/recent";
import { formatPrice } from "@/lib/format";
import { useSearchSuggestions } from "@/lib/use-search-suggestions";

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
          <strong key={i} className="font-bold text-white">{part}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function HeroSearch() {
  const router = useRouter();
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
    (value: string, category?: string, brand?: string) => {
      const params = new URLSearchParams();
      const clean = value.trim();
      if (clean) {
        params.set("q", clean);
        pushRecentSearch(clean);
      }
      if (category) params.set("category", category);
      if (brand) params.set("brand", brand);
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

  const searchActionEnd = hasQuery ? 1 : 0;
  const partsEnd = searchActionEnd + (results?.parts.length ?? 0);
  const suggestCatEnd = partsEnd + (results?.categories.length ?? 0);
  const suggestBrandEnd = suggestCatEnd + (results?.brands.length ?? 0);
  const recentsStart = suggestBrandEnd;
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
      if (index < suggestCatEnd && results) {
        const cat = results.categories[index - partsEnd];
        if (cat) submit("", cat);
        return;
      }
      if (index < suggestBrandEnd && results) {
        const brand = results.brands[index - suggestCatEnd];
        if (brand) submit("", undefined, brand);
        return;
      }
      if (index < recentsEnd) {
        const recent = recents[index - recentsStart];
        if (recent) submit(recent);
      }
    },
    [hasQuery, query, results, recents, submit, navigateToPart, searchActionEnd, partsEnd, suggestCatEnd, suggestBrandEnd, recentsStart, recentsEnd],
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

  useEffect(() => {
    if (activeIndex < 0 || !open) return;
    const el = listRef.current?.querySelector(`[data-aidx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const itemBase =
    "flex min-h-touch w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors";

  return (
    <div ref={rootRef} className="relative">
      <form
        role="search"
        aria-label="Search all motor parts"
        aria-haspopup="listbox"
        aria-expanded={open}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit(query);
        }}
        className="flex max-w-3xl flex-col gap-1 border-2 border-white bg-white p-1 text-graphite-950 xs:flex-row"
      >
        <div className="flex min-w-0 flex-1 items-center">
          <SearchIcon className="ml-3 h-5 w-5 shrink-0 text-graphite-600" />
          <label htmlFor="home-search" className="sr-only">
            Search all motor parts
          </label>
          <input
            ref={inputRef}
            id="home-search"
            name="q"
            type="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-autocomplete="list"
            aria-controls="hero-search-listbox"
            aria-activedescendant={activeIndex >= 0 ? `hero-opt-${activeIndex}` : undefined}
            aria-expanded={open}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-touch min-w-0 flex-1 self-stretch border-0 bg-transparent px-3 py-3 text-base font-medium outline-none placeholder:font-normal placeholder:text-graphite-600"
            placeholder="OE number, brake caliper, BMW N47 alternator"
          />
          {loading && hasQuery && <Spinner className="h-4 w-4 mr-1 shrink-0" />}
        </div>
        <button
          type="submit"
          className="min-h-touch shrink-0 bg-signal-500 px-5 text-sm font-black uppercase tracking-wide text-graphite-950 transition-colors hover:bg-signal-600"
        >
          Find parts
        </button>
      </form>

      {open && (hasQuery || recents.length > 0) && (
        <div
          ref={listRef}
          id="hero-search-listbox"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-dropdown mt-2 max-h-[min(32rem,60dvh)] overflow-y-auto overscroll-none-y border-2 border-graphite-950 bg-white shadow-overlay"
        >
          {hasQuery && (
            <button
              id="hero-opt-0"
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
            </button>
          )}

          {showSuggestions && results.parts.length > 0 && (
            <section aria-label="Matching parts" className="border-b border-stone-200">
              <p className="eyebrow px-4 pt-3 pb-1.5">Parts</p>
              {results.parts.map((part, i) => {
                const idx = searchActionEnd + i;
                return (
                  <button
                    id={`hero-opt-${idx}`}
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
                        {part.brand && <span>{part.brand}</span>}
                        {part.category && <span>{part.category}</span>}
                        {part.manufacturerPartNumber && (
                          <span className="part-number">{part.manufacturerPartNumber}</span>
                        )}
                      </span>
                    </span>
                    {part.minPrice != null && (
                      <span className="shrink-0 text-sm font-bold text-graphite-950">
                        {formatPrice(part.minPrice, part.currency)}
                      </span>
                    )}
                  </button>
                );
              })}
            </section>
          )}

          {showSuggestions &&
            (results.categories.length > 0 || results.brands.length > 0) && (
              <section className="border-b border-stone-200">
                <div className="grid sm:grid-cols-2">
                  {results.categories.length > 0 && (
                    <div className="border-b border-stone-200 p-3 sm:border-b-0 sm:border-r">
                      <p className="eyebrow px-2 py-1">Categories</p>
                      {results.categories.map((cat, i) => {
                        const idx = partsEnd + i;
                        return (
                          <button
                            id={`hero-opt-${idx}`}
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
                            <span className="min-w-0 truncate">{cat}</span>
                            <ChevronRightIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {results.brands.length > 0 && (
                    <div className="p-3">
                      <p className="eyebrow px-2 py-1">Brands</p>
                      {results.brands.map((brand, i) => {
                        const idx = suggestCatEnd + i;
                        return (
                          <button
                            id={`hero-opt-${idx}`}
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
                            <span className="min-w-0 truncate">{brand}</span>
                            <ChevronRightIcon className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}

          {recents.length > 0 && (
            <section aria-label="Recent searches" className="p-3">
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <p className="eyebrow">Recent searches</p>
              </div>
              {recents.slice(0, 5).map((recent, i) => {
                const idx = recentsStart + i;
                return (
                  <button
                    id={`hero-opt-${idx}`}
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

          {hasQuery && !loading && results && results.parts.length === 0 && results.categories.length === 0 && results.brands.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm font-semibold text-graphite-950">No suggestions</p>
              <p className="mt-1 text-xs text-graphite-600">
                Press Enter to search for &ldquo;{query.trim()}&rdquo;
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
