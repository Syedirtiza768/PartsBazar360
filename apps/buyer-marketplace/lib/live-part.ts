/**
 * Live part lookup for client rails (recently viewed, watchlist).
 * Returns null when the part is gone or has no buyer-visible offers
 * (API getPart already 404s in those cases).
 */

import { API_BASE_URL } from "./api";
import type { Part } from "./types";

const partCache = new Map<string, Promise<Part | null>>();

export function fetchLivePart(partId: string): Promise<Part | null> {
  let cached = partCache.get(partId);
  if (!cached) {
    cached = fetch(`${API_BASE_URL}/search/parts/${encodeURIComponent(partId)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? (res.json() as Promise<Part>) : null))
      .catch(() => null);
    partCache.set(partId, cached);
  }
  return cached;
}

/** Drop a cached entry so a later check can pick up a revived listing. */
export function invalidateLivePart(partId: string) {
  partCache.delete(partId);
}
