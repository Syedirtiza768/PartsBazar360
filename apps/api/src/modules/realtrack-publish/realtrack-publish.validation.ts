/**
 * Cheap structural checks on a pushed listing, run before it is queued so a
 * malformed payload is rejected synchronously with a reason RealTrack can show.
 *
 * Business eligibility (English title, stock, marketplace, brand exclusions)
 * is deliberately NOT duplicated here — the worker applies the same
 * `processListing` rules the pull sync uses and reports the outcome through
 * the status endpoint.
 */
export function validatePushedListing(
  listing: Record<string, unknown>,
): string | null {
  const title = listing.title;
  if (typeof title !== 'string' || !title.trim()) {
    return 'title is required';
  }
  if (title.length > 500) return 'title is too long';

  const price = listing.price;
  const numericPrice =
    typeof price === 'number'
      ? price
      : typeof price === 'string'
        ? Number(price.replace(/,/g, ''))
        : NaN;
  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    return 'price must be a non-negative number';
  }

  const currency = listing.currency;
  if (currency !== undefined && currency !== null) {
    if (
      typeof currency !== 'string' ||
      currency.trim().toUpperCase() !== 'USD'
    ) {
      // The marketplace catalog is USD-only (MARKETPLACE_CURRENCY); accepting
      // another currency would silently misprice the offer.
      return 'currency must be USD';
    }
  }

  const quantity = listing.quantityAvailable ?? listing.quantity;
  if (quantity !== undefined && quantity !== null && quantity !== '') {
    const n = typeof quantity === 'number' ? quantity : Number(quantity);
    if (!Number.isInteger(n) || n < 0) {
      return 'quantity must be a non-negative integer';
    }
  }

  const images = listing.imageUrls;
  if (images !== undefined && !Array.isArray(images)) {
    return 'imageUrls must be an array';
  }

  return null;
}
