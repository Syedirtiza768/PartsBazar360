/**
 * Image paths that were written by the Parts Finder import before the serving
 * route existed. They are data errors, not usable same-origin image URLs.
 */
const DEAD_CATALOG_IMAGE_PATH =
  /^\/api\/search\/parts\/[^/]+\/catalog-image\/\d+\.(?:jpe?g|png|webp)(?:\?.*)?$/i;

export function isDeadCatalogImagePath(value: unknown): boolean {
  return (
    typeof value === 'string' && DEAD_CATALOG_IMAGE_PATH.test(value.trim())
  );
}

export function filterDeadCatalogImagePaths<T extends { url?: unknown }>(
  values: T[],
): T[] {
  return values.filter((value) => !isDeadCatalogImagePath(value.url));
}
