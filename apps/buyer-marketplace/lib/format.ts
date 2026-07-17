export function formatPrice(
  price: number | null | undefined,
  currency?: string | null,
): string {
  if (price === null || price === undefined || Number.isNaN(price)) return "—";
  // Older search-index documents carry no currency. Formatting the number
  // without asserting a (possibly wrong) symbol is more honest than a "$"
  // fallback that contradicts the product page.
  if (!currency) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  }
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(price);
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
