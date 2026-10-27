/**
 * "What can we sell now" — decided from Postgres rows at query time, never
 * from the search index (the index drifts: offers end, stock changes).
 *
 *   in_stock      – an ACTIVE offer from an ACTIVE seller, priced, with
 *                   quantity > 0 in at least one warehouse.
 *   can_source    – an ACTIVE offer with no stock on hand but a lead time
 *                   (supplier / on-demand), or Omni Core on-demand sourcing.
 *   not_available – only ended/paused offers, unpriced offers or no offers.
 */

import type { InternalOffer } from '../internal-search.service';

export type Availability = 'in_stock' | 'can_source' | 'not_available';

export const AVAILABILITY_ORDER: Availability[] = [
  'in_stock',
  'can_source',
  'not_available',
];

/** Condition ranking for "best condition first" (lower is better). */
const CONDITION_RANK: Record<string, number> = {
  NEW: 0,
  NEW_OTHER: 1,
  REMANUFACTURED: 2,
  REFURBISHED: 3,
  USED: 4,
  FOR_PARTS: 5,
};

export function conditionRank(condition: string | null | undefined): number {
  return CONDITION_RANK[String(condition ?? '').toUpperCase()] ?? 6;
}

export interface AvailabilitySummary {
  status: Availability;
  totalQuantity: number;
  sellableOffers: number;
  sellerCount: number;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  bestCondition: string | null;
  locations: Array<{
    warehouse: string;
    location: string | null;
    quantity: number;
    seller: string;
  }>;
  leadTimeDays: number | null;
}

function sellable(offer: InternalOffer): boolean {
  return (
    offer.status === 'ACTIVE' &&
    (offer.sellerStatus === 'ACTIVE' || offer.sellerStatus === 'UNKNOWN') &&
    Number(offer.price) > 0
  );
}

export function summarizeAvailability(
  offers: InternalOffer[],
): AvailabilitySummary {
  const live = offers.filter(sellable);
  const stocked = live.filter((offer) => offer.quantity > 0);
  const sourceable = live.filter(
    (offer) => offer.quantity <= 0 && (offer.leadTimeDays ?? 0) > 0,
  );
  const priced = stocked.length ? stocked : sourceable;
  const prices = priced
    .map((offer) => Number(offer.price))
    .filter((price) => price > 0);
  const best = [...priced].sort(
    (a, b) => conditionRank(a.condition) - conditionRank(b.condition),
  )[0];
  const locations = stocked.flatMap((offer) =>
    offer.warehouses
      .filter((warehouse) => warehouse.quantity > 0)
      .map((warehouse) => ({
        warehouse: warehouse.name,
        location: warehouse.location,
        quantity: warehouse.quantity,
        seller: offer.sellerName,
      })),
  );
  const status: Availability = stocked.length
    ? 'in_stock'
    : sourceable.length
      ? 'can_source'
      : 'not_available';
  const leadTimes = sourceable
    .map((offer) => offer.leadTimeDays ?? 0)
    .filter((days) => days > 0);
  return {
    status,
    totalQuantity: stocked.reduce((sum, offer) => sum + offer.quantity, 0),
    sellableOffers: priced.length,
    sellerCount: new Set(priced.map((offer) => offer.sellerId)).size,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    currency: priced[0]?.currency ?? null,
    bestCondition: best?.condition ?? null,
    locations,
    leadTimeDays:
      status === 'can_source' && leadTimes.length
        ? Math.min(...leadTimes)
        : null,
  };
}
