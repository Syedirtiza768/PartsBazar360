/**
 * Catalog visibility.
 *
 * Some parts must exist and be purchasable without ever appearing in the
 * catalog — today that is the 1 AED payment-verification item used to exercise
 * a live Stripe / Tamara checkout against real money without listing a fake
 * product to buyers.
 *
 * "Hidden" is deliberately one flag consulted by every surface rather than a
 * special case per surface. A part that is hidden is:
 *   - absent from both search indexes (so it cannot appear in browse, search,
 *     facets, related products, or fitment results),
 *   - `noindex` (so a crawler that finds the URL will not index it),
 *   - absent from every sitemap,
 *   - still reachable by its own URL, so checkout can be driven end to end.
 *
 * Lives outside `seo/` because it is a catalog concept the search indexers
 * consume too, and importing it from there would make the SEO engine a
 * dependency of indexing.
 */

/** Key written into `CanonicalPart.itemSpecifics` to hide a part. */
export const CATALOG_HIDDEN_KEY = '_hiddenFromCatalog';

/**
 * Fixed id for the payment-verification item, so the seeder is idempotent and
 * the same row is updated rather than duplicated on every run. A valid v4-
 * shaped UUID, chosen to be obviously synthetic in a database dump.
 */
export const PAYMENT_TEST_PART_ID = '00000000-0000-4000-8000-000000000001';

/** Fixed slug, so the checkout-test URL never moves. */
export const PAYMENT_TEST_SLUG = 'payment-verification-item';

/**
 * True when a part is flagged hidden from the catalog.
 *
 * Accepts anything with an `itemSpecifics` bag — a Prisma row, an API payload,
 * or a search-document input — because all three reach this check.
 */
export function isCatalogHidden(part: {
  itemSpecifics?: Record<string, unknown> | null;
} | null | undefined): boolean {
  const specifics = part?.itemSpecifics;
  if (!specifics || typeof specifics !== 'object') return false;
  return (specifics as Record<string, unknown>)[CATALOG_HIDDEN_KEY] === true;
}
