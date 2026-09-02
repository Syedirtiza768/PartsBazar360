"use client";

import { useEffect, useRef } from "react";
import { buyerVisibleOffers } from "@/lib/format";
import { useCurrency } from "@/lib/currency-context";
import { ecommerceMoney, pushViewItem } from "@/lib/ecommerce-tracking";
import type { Part } from "@/lib/types";

export function ViewItemTracker({ part }: { part: Part }) {
  const offer = buyerVisibleOffers(part.offers)[0];
  const { currency, convert, ready } = useCurrency();
  const trackedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !offer) return;
    const price = ecommerceMoney(convert(offer.price, offer.currency));
    const key = `${part.id}:${offer.id}:${currency}:${price}`;
    if (trackedKey.current === key) return;

    const pushed = pushViewItem({
      currency,
      value: price,
      items: [
        {
          item_id: part.id,
          item_name: part.title,
          price,
          quantity: 1,
        },
      ],
    });
    if (pushed) trackedKey.current = key;
  }, [currency, convert, offer, part.id, part.title, ready]);

  return null;
}
