"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClockIcon } from "@repo/ui/icons";
import { PartImage } from "./PartImage";
import { Price } from "./Price";
import { getRecentlyViewed, setRecentlyViewed, type RecentPart } from "@/lib/recent";
import { fetchLivePart } from "@/lib/live-part";
import { lowestOfferPrice, offerCurrency } from "@/lib/format";

/**
 * Horizontal rail of parts the buyer opened recently (device-local).
 * Snapshots in localStorage are re-checked against the live API so deleted
 * / no-offer parts never appear — stale IDs are pruned from storage.
 */
export function RecentlyViewed({ excludeId }: { excludeId?: string }) {
  const [items, setItems] = useState<RecentPart[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const local = getRecentlyViewed().filter((p) => p.id !== excludeId);

    if (local.length === 0) {
      setItems([]);
      return;
    }

    (async () => {
      const checked = await Promise.all(
        local.map(async (snapshot): Promise<RecentPart | null> => {
          const live = await fetchLivePart(snapshot.id);
          if (!live) return null;
          return {
            id: live.id,
            title: live.title,
            image: live.imageUrls?.[0] ?? snapshot.image ?? null,
            price: lowestOfferPrice(live.offers) ?? snapshot.price ?? null,
            currency: offerCurrency(live.offers) ?? snapshot.currency ?? null,
            viewedAt: snapshot.viewedAt,
          };
        }),
      );
      if (cancelled) return;
      const alive = checked.filter((row): row is RecentPart => row !== null);
      // Keep excludeId in storage if present; only rewrite the filtered list
      // when we are not excluding (home). When excluding (PDP), merge prune
      // into full storage by dropping dead IDs only.
      const deadIds = new Set(
        local.filter((p) => !alive.some((a) => a.id === p.id)).map((p) => p.id),
      );
      if (deadIds.size > 0 || alive.length !== local.length) {
        const full = getRecentlyViewed().filter((p) => !deadIds.has(p.id));
        // Refresh surviving snapshots with live title/price/image when we have them.
        const byId = new Map(alive.map((a) => [a.id, a]));
        setRecentlyViewed(
          full.map((p) => {
            const refreshed = byId.get(p.id);
            return refreshed ? { ...p, ...refreshed, viewedAt: p.viewedAt } : p;
          }),
        );
      }
      setItems(alive);
    })();

    return () => {
      cancelled = true;
    };
  }, [excludeId]);

  if (!items || items.length === 0) return null;

  return (
    <section aria-labelledby="recently-viewed-heading">
      <h2
        id="recently-viewed-heading"
        className="flex items-center gap-2 text-lg font-semibold text-slate-900"
      >
        <ClockIcon className="h-5 w-5 text-slate-400" />
        Recently viewed
      </h2>
      <div className="-mx-1 mt-4 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-thin">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/part/${item.id}`}
            className="w-40 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card-hover"
          >
            <div className="relative aspect-square border-b border-slate-100 bg-slate-50">
              <PartImage src={item.image} alt={item.title} className="object-contain p-2" />
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-xs font-medium leading-snug text-slate-700">
                {item.title}
              </p>
              {item.price != null && (
                <Price amount={item.price} currency={item.currency} size="sm" className="mt-1.5" />
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
