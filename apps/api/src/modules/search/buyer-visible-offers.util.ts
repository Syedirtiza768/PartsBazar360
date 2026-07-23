/**
 * Buyer-facing offer visibility for search/browse cards.
 * OpenSearch may still carry legacy inactive-seller duplicates until reindex.
 */

const HIDDEN_SELLER_IDS = new Set([
  'seed-febest-inventory-supplier',
]);

const HIDDEN_SELLER_NAME_RE = /febest\s+inventory\s+supplier/i;

export type IndexedOfferLike = {
  sellerId?: string | null;
  sellerName?: string | null;
  status?: string | null;
  price?: number | null;
  seller?: { name?: string | null; onboardingStatus?: string | null } | null;
  [key: string]: unknown;
};

export type SearchItemLike = {
  id?: string;
  offers?: IndexedOfferLike[] | null;
  minPrice?: number | null;
  [key: string]: unknown;
};

export function isBuyerVisibleIndexedOffer(offer: IndexedOfferLike | null | undefined): boolean {
  if (!offer) return false;
  if (offer.sellerId && HIDDEN_SELLER_IDS.has(offer.sellerId)) return false;
  const name = offer.sellerName || offer.seller?.name || '';
  if (HIDDEN_SELLER_NAME_RE.test(name)) return false;
  // When status is present (PDP-shaped payloads), enforce ACTIVE.
  if (offer.status && offer.status !== 'ACTIVE') return false;
  if (offer.seller?.onboardingStatus && offer.seller.onboardingStatus !== 'ACTIVE') {
    return false;
  }
  // Never surface a price-less offer — a tile/PDP without a price is worse
  // than no tile at all, and stale OS docs occasionally lack the price field.
  if (offer.price === null || offer.price === undefined || Number(offer.price) <= 0) {
    return false;
  }
  return Boolean(offer.sellerId || name);
}

export function sanitizeSearchItem<T extends SearchItemLike>(item: T): T | null {
  if (!item) return null;
  const offers = (item.offers || [])
    .filter(isBuyerVisibleIndexedOffer)
    .slice()
    .sort((a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity));
  if (offers.length === 0) return null;
  const minPrice = Math.min(...offers.map((o) => Number(o.price) || Infinity));
  return {
    ...item,
    offers,
    minPrice: Number.isFinite(minPrice) ? minPrice : item.minPrice ?? null,
  };
}

export function sanitizeSearchItems<T extends SearchItemLike>(items: T[] = []): T[] {
  return (items || []).map((item) => sanitizeSearchItem(item)).filter((item): item is T => Boolean(item));
}
