/**
 * URL resolution for product pages.
 *
 * The storefront never decides on its own whether a `/parts/<segment>` request
 * should render or redirect — it asks the API, which owns slugs, slug history,
 * and part merges. Keeping the decision server-side means the redirect rules
 * are identical for every client and, critically, that a redirect is always a
 * *single* hop: the resolver answers with the part's current slug, never with
 * whatever slug superseded the requested one.
 */

import { INTERNAL_API_URL } from "@/lib/api";
import type { Part } from "@/lib/types";

export interface ResolvedPart {
  id: string;
  slug: string | null;
  /** Present when the caller must issue a permanent redirect to this slug. */
  redirectToSlug?: string;
  reason?: "retired-slug" | "legacy-id" | "merged";
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fallback for when the API has no `/seo/resolve` route.
 *
 * The storefront and the API deploy as separate containers, so there is a
 * window — during a rollout, or if the API is rolled back — where this app is
 * newer than the API it talks to. Without this, every product page would 404
 * during that window, which is a far worse failure than serving the legacy
 * URL. A UUID segment is therefore rendered directly with no redirect, exactly
 * as the old `/part/[id]` route did.
 *
 * Safe to delete once the SEO API release is the guaranteed floor.
 */
function legacyFallback(segment: string): ResolvedPart | null {
  return UUID_PATTERN.test(segment) ? { id: segment, slug: null } : null;
}

/**
 * Resolve a URL segment (current slug, retired slug, or legacy UUID).
 * Returns null for a segment that matches nothing — the caller 404s.
 */
export async function resolvePartSegment(
  segment: string,
): Promise<ResolvedPart | null> {
  try {
    const res = await fetch(
      `${INTERNAL_API_URL}/seo/resolve/${encodeURIComponent(segment)}`,
      {
        // Slug→id mapping is effectively immutable, so it caches well; the
        // tag lets a slug regeneration purge just this entry.
        next: { revalidate: 3600, tags: [`seo:resolve:${segment}`] },
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (res.ok) return (await res.json()) as ResolvedPart;

    // Both "no such part" and "no such route" are 404s. Nest's route-missing
    // body says `Cannot GET /seo/resolve/…`; a genuine miss does not. Only
    // the former warrants the compatibility fallback — a real 404 must stay
    // a 404, or unknown URLs would start rendering pages.
    if (res.status === 404) {
      const body = await res.text().catch(() => "");
      return /Cannot (GET|find)/i.test(body) ? legacyFallback(segment) : null;
    }

    // 5xx / gateway error: the API is unhealthy rather than authoritative.
    return legacyFallback(segment);
  } catch {
    // Network failure or timeout — same reasoning as above.
    return legacyFallback(segment);
  }
}

/** Load a part by id for rendering. */
export async function getPartById(id: string): Promise<Part | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts/${id}`, {
      next: { revalidate: 45, tags: [`part:${id}`] },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Part;
  } catch {
    return null;
  }
}

/**
 * Candidate parts for the "related products" module.
 *
 * Pulled from the same browse endpoint the search page uses, scoped to the
 * part's own category (falling back to its brand), so the candidate pool is
 * already topically relevant before the scorer ranks it. Deliberately best-
 * effort: a failure returns an empty list rather than failing the page, since
 * related products are an enhancement and the taxonomy links already prevent
 * the page from being an orphan.
 */
export async function getRelatedCandidates(part: Part): Promise<Part[]> {
  const params = new URLSearchParams();
  if (part.category) params.set("category", part.category);
  else if (part.categoryGroup) params.set("categoryGroup", part.categoryGroup);
  else if (part.brand) params.set("brand", part.brand);
  else return [];
  params.set("pageSize", "40");
  params.set("sort", "newest");

  try {
    const res = await fetch(
      `${INTERNAL_API_URL}/search/parts?${params.toString()}`,
      {
        next: { revalidate: 300, tags: ["related"] },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Part[] };
    return (data.items ?? []).filter((candidate) => candidate.id !== part.id);
  } catch {
    return [];
  }
}
