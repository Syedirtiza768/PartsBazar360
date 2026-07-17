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

export function lowestOfferPrice(offers?: { price: number }[]): number | null {
  if (!offers || offers.length === 0) return null;
  return Math.min(...offers.map((o) => o.price));
}

/** Currency shared by the offers, or null when the data doesn't say. */
export function offerCurrency(offers?: { currency?: string | null }[]): string | null {
  return offers?.find((o) => o.currency)?.currency ?? null;
}

/** Human label for enum-ish values: "FOR_PARTS" -> "For parts". */
export function humanize(value?: string | null): string {
  if (!value) return "";
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
