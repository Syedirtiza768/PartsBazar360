/**
 * Storefront locale. Drives currency symbol placement and digit grouping —
 * an AED price formatted as en-US reads "AED 1,234.00" rather than the
 * "AED 1,234.00" / "د.إ ١٬٢٣٤٫٠٠" a Gulf buyer expects. Kept as a single
 * constant so the Arabic/RTL locale segment has one place to hook into.
 */
export const STOREFRONT_LOCALE = "en-AE";

export function formatPrice(
  price: number | null | undefined,
  currency?: string | null,
  locale: string = STOREFRONT_LOCALE,
): string {
  if (price === null || price === undefined || Number.isNaN(price)) return "—";
  // Older search-index documents carry no currency. Formatting the number
  // without asserting a (possibly wrong) symbol is more honest than a "$"
  // fallback that contradicts the product page.
  if (!currency) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  }
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

const HIDDEN_SELLER_IDS = new Set(["seed-febest-inventory-supplier"]);
const HIDDEN_SELLER_NAME_RE = /febest\s+inventory\s+supplier/i;

/** Buyer-visible offers only — drops legacy/suspended sellers from card/PDP payloads. */
export function buyerVisibleOffers<T extends {
  price?: number;
  sellerId?: string | null;
  sellerName?: string | null;
  status?: string | null;
  seller?: { name?: string | null; onboardingStatus?: string | null } | null;
}>(offers?: T[] | null): T[] {
  return (offers || [])
    .filter((offer) => {
      if (!offer) return false;
      if (offer.sellerId && HIDDEN_SELLER_IDS.has(offer.sellerId)) return false;
      const name = offer.sellerName || offer.seller?.name || "";
      if (HIDDEN_SELLER_NAME_RE.test(name)) return false;
      if (offer.status && offer.status !== "ACTIVE") return false;
      if (offer.seller?.onboardingStatus && offer.seller.onboardingStatus !== "ACTIVE") return false;
      if (offer.price === null || offer.price === undefined || Number(offer.price) <= 0) return false;
      return Boolean(offer.sellerId || name);
    })
    .slice()
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

export function lowestOfferPrice(offers?: { price: number }[]): number | null {
  const visible = buyerVisibleOffers(offers);
  if (visible.length === 0) return null;
  return Math.min(...visible.map((o) => o.price as number));
}

/** Currency shared by the offers, or null when the data doesn't say. */
export function offerCurrency(
  offers?: Array<{
    currency?: string | null;
    price?: number;
    sellerId?: string | null;
    sellerName?: string | null;
    status?: string | null;
    seller?: { name?: string | null; onboardingStatus?: string | null } | null;
  }>,
): string | null {
  return buyerVisibleOffers(offers).find((o) => o.currency)?.currency ?? null;
}

/** Human label for enum-ish values: "FOR_PARTS" -> "For parts". */
export function humanize(value?: string | null): string {
  if (!value) return "";
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
