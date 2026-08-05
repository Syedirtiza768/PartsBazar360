/**
 * Buyer-facing offer visibility for search/browse cards.
 * OpenSearch may still carry legacy inactive-seller duplicates until reindex.
 */

const HIDDEN_SELLER_IDS = new Set(['seed-febest-inventory-supplier']);

const HIDDEN_SELLER_NAME_RE = /febest\s+inventory\s+supplier/i;

export const SUPERIOR_SELLER_ID = 'seller-superior-auto-parts';
const SUPERIOR_SELLER_NAME_RE = /superior\s+auto\s+parts/i;

/**
 * Sellers Superior outranks on the same part, regardless of price.
 *
 * Matched by name as well as ID on purpose: the seed config assigns slug IDs,
 * but sellers created through the RealTrack importer get a UUID instead, so
 * production carries "Blackline Auto Parts" under a UUID and the slug
 * `seller-blackline-auto-parts` matches nothing. An ID-only rule silently
 * suppressed Salvage while letting every Blackline offer through.
 */
export const SUPERFLOUS_SELLER_IDS = new Set([
  'seller-blackline-auto-parts',
  'seller-salvage-auto-parts',
  '21924d3c-b345-4dcd-900c-b4bcf92b01c0', // Blackline Auto Parts (production)
]);
const SUPERFLOUS_SELLER_NAME_RE = /\b(?:blackline|salvage)\s+auto\s+parts\b/i;

type OfferSellerLike = {
  sellerId?: string | null;
  sellerName?: string | null;
  seller?: { name?: string | null } | null;
};

function sellerNameOf(offer: OfferSellerLike | null | undefined): string {
  return offer?.sellerName || offer?.seller?.name || '';
}

export function isSuperiorOffer(offer: OfferSellerLike): boolean {
  return (
    offer?.sellerId === SUPERIOR_SELLER_ID ||
    SUPERIOR_SELLER_NAME_RE.test(sellerNameOf(offer))
  );
}

export function isOutrankedBySuperior(offer: OfferSellerLike): boolean {
  return (
    SUPERFLOUS_SELLER_IDS.has(offer?.sellerId ?? '') ||
    SUPERFLOUS_SELLER_NAME_RE.test(sellerNameOf(offer))
  );
}

/**
 * Superior takes priority: when a part has a Superior offer, Blackline and
 * Salvage offers on that same part are not shown to buyers. Applied at index
 * time (so price sort, price filters and the source-tag facet agree with the
 * rendered card) and again at read time (so stale OpenSearch docs written
 * before a reindex still obey the rule).
 */
export function applySuperiorPriority<T extends OfferSellerLike>(
  offers: T[],
): T[] {
  if (!offers.some(isSuperiorOffer)) return offers;
  return offers.filter((offer) => !isOutrankedBySuperior(offer));
}

export type IndexedOfferLike = {
  sellerId?: string | null;
  sellerName?: string | null;
  status?: string | null;
  price?: number | null;
  sourceTag?: string | null;
  seller?: { name?: string | null; onboardingStatus?: string | null } | null;
  [key: string]: unknown;
};

export type SearchItemLike = {
  id?: string;
  offers?: IndexedOfferLike[] | null;
  minPrice?: number | null;
  [key: string]: unknown;
};

export type OfferFilterConstraints = {
  sourceTags?: string[];
  minPrice?: number;
  maxPrice?: number;
};

export function isBuyerVisibleIndexedOffer(
  offer: IndexedOfferLike | null | undefined,
): boolean {
  if (!offer) return false;
  if (offer.sellerId && HIDDEN_SELLER_IDS.has(offer.sellerId)) return false;
  const name = offer.sellerName || offer.seller?.name || '';
  if (HIDDEN_SELLER_NAME_RE.test(name)) return false;
  // When status is present (PDP-shaped payloads), enforce ACTIVE.
  if (offer.status && offer.status !== 'ACTIVE') return false;
  if (
    offer.seller?.onboardingStatus &&
    offer.seller.onboardingStatus !== 'ACTIVE'
  ) {
    return false;
  }
  // Never surface a price-less offer — a tile/PDP without a price is worse
  // than no tile at all, and stale OS docs occasionally lack the price field.
  if (
    offer.price === null ||
    offer.price === undefined ||
    Number(offer.price) <= 0
  ) {
    return false;
  }
  return Boolean(offer.sellerId || name);
}

export function sanitizeSearchItem<T extends SearchItemLike>(
  item: T,
  constraints: OfferFilterConstraints = {},
): T | null {
  if (!item) return null;
  const selectedTags = new Set(
    (constraints.sourceTags || []).map((tag) => tag.toUpperCase()),
  );
  const filtered = (item.offers || []).filter(isBuyerVisibleIndexedOffer);
  const offers = applySuperiorPriority(filtered)
    .filter((offer) => {
      const price = Number(offer.price);
      if (selectedTags.size > 0) {
        const tag = String(offer.sourceTag || '').toUpperCase();
        if (!selectedTags.has(tag)) return false;
      }
      if (constraints.minPrice != null && price < constraints.minPrice) {
        return false;
      }
      if (constraints.maxPrice != null && price > constraints.maxPrice) {
        return false;
      }
      return true;
    })
    .slice()
    .sort(
      (a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity),
    );
  if (offers.length === 0) return null;
  const minPrice = Math.min(...offers.map((o) => Number(o.price) || Infinity));
  const imageUrls = (item.imageUrls as string[] | undefined) || [];
  // Inject placeholder SVG for items with no seller photos
  if (imageUrls.length === 0 && item.id) {
    imageUrls.push(`/api/search/parts/${item.id}/placeholder.svg`);
  }
  return {
    ...item,
    offers,
    minPrice: Number.isFinite(minPrice) ? minPrice : (item.minPrice ?? null),
    imageUrls,
  };
}

export function sanitizeSearchItems<T extends SearchItemLike>(
  items: T[] = [],
  constraints: OfferFilterConstraints = {},
): T[] {
  return (items || [])
    .map((item) => sanitizeSearchItem(item, constraints))
    .filter((item): item is T => Boolean(item));
}
