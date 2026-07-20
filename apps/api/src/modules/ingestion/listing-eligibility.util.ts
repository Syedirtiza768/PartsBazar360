/** Shared RealTrack listing eligibility + USD pricing helpers for marketplace sync. */

/**
 * Returns stock quantity when the payload carries one; `null` when unknown.
 * Explicit zero is zero (not treated as missing).
 */
export function listingQuantity(listing: any): number | null {
  const raw =
    listing?.quantityAvailable ??
    listing?.quantity ??
    listing?.availableQuantity ??
    listing?.qty;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** True when RealTrack listing is publishable/active (not ended/draft/etc.). */
export function isActiveListingStatus(listing: any): boolean {
  const status = String(
    listing?.listingStatus ?? listing?.status ?? listing?.offerStatus ?? '',
  )
    .trim()
    .toUpperCase();
  if (!status) return true; // published-listings feed with no status field
  const inactive = [
    'ENDED',
    'INACTIVE',
    'DRAFT',
    'UNPUBLISHED',
    'OUT_OF_STOCK',
    'SOLD',
    'COMPLETED',
    'ARCHIVED',
    'DELETED',
    'WITHDRAWN',
  ];
  if (inactive.includes(status)) return false;
  return [
    'ACTIVE',
    'PUBLISHED',
    'LIVE',
    'AVAILABLE',
    'FOR_SALE',
    'PUBLISH',
  ].includes(status) || !inactive.includes(status);
}

/**
 * Marketplace import rule: only active, in-stock listings.
 * Explicit zero quantity is excluded; missing quantity is allowed (treated as in stock).
 */
export function isImportableListing(listing: any): boolean {
  if (!isActiveListingStatus(listing)) return false;
  const qty = listingQuantity(listing);
  if (qty === null) return true;
  return qty > 0;
}

export function stockQuantityForImport(listing: any): number {
  const qty = listingQuantity(listing);
  return qty === null ? 1 : qty;
}

/** Buyer-facing catalog currency for RealTrack + Superior seed imports. */
export const MARKETPLACE_CURRENCY = 'USD';
