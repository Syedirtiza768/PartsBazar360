"use client";

import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import { HeartIcon, SearchIcon } from "@repo/ui/icons";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { ProductCard } from "@/components/ProductCard";
import { useWatchlist } from "@/lib/watchlist-context";

export default function WatchlistPage() {
  const { items, ready } = useWatchlist();

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-slate-950 pb-4">
        <div>
          <p className="eyebrow">Saved listings</p>
          <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-slate-950 sm:text-4xl">Watchlist</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">Keep listings together while you compare fitment evidence, condition, seller terms, and price.</p>
        </div>
        {ready && items.length > 0 && <p className="font-mono text-xs font-bold uppercase tracking-wide text-graphite-600">{items.length} watched listing{items.length === 1 ? "" : "s"}</p>}
      </header>

      {!ready ? (
        <div className="mt-6 grid grid-cols-2 gap-px border border-stone-300 bg-stone-300 md:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="aspect-[3/4] rounded-none" />)}</div>
      ) : items.length === 0 ? (
        <div className="mt-8 border-2 border-slate-950 bg-white">
          <EmptyState variant="page" icon={<HeartIcon />} title="Your watchlist is empty" description="Watch a listing from search results or a part page. It will stay on this device until you remove it.">
            <Link href="/search" className={buttonClasses()}><SearchIcon className="h-4 w-4" />Browse parts</Link>
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-px border border-stone-300 bg-stone-300 md:grid-cols-3 lg:grid-cols-4">{items.map((part) => <ProductCard key={part.id} part={part} />)}</div>
      )}
    </div>
  );
}
