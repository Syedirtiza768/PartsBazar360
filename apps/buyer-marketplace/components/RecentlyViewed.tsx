"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClockIcon } from "@repo/ui/icons";
import { PartImage } from "./PartImage";
import { Price } from "./Price";
import { getRecentlyViewed, type RecentPart } from "@/lib/recent";

/**
 * Horizontal rail of parts the buyer opened recently (device-local).
 * Renders nothing until mounted and only when there's history.
 */
export function RecentlyViewed({ excludeId }: { excludeId?: string }) {
  const [items, setItems] = useState<RecentPart[]>([]);

  useEffect(() => {
    setItems(getRecentlyViewed().filter((p) => p.id !== excludeId));
  }, [excludeId]);

  if (items.length === 0) return null;

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
