export function formatPrice(price: number | null | undefined, currency = 'USD'): string {
  if (price === null || price === undefined || Number.isNaN(price)) return 'N/A';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

export function lowestOfferPrice(offers?: { price: number }[]): number | null {
  if (!offers || offers.length === 0) return null;
  return Math.min(...offers.map((o) => o.price));
}

export function offerCurrency(offers?: { currency?: string }[]): string {
  return offers?.[0]?.currency || 'USD';
}
