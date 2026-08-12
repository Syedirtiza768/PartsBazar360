import { notFound, permanentRedirect } from "next/navigation";
import { partPath } from "@repo/catalog-contracts";
import { resolvePartSegment } from "@/lib/part-resolve";

/**
 * Legacy product URL: `/part/<uuid>`.
 *
 * Every URL this site published before the slug migration has this shape, and
 * a good number of them are indexed and linked. The route therefore stays
 * alive permanently as a 301 to the canonical `/parts/<slug>` URL rather than
 * being deleted — deleting it would 404 the entire indexed catalog and throw
 * away its accumulated ranking.
 *
 * The redirect is always a single hop: `resolvePartSegment` answers with the
 * part's *current* slug, so even a part whose slug has since been regenerated
 * (or which was merged into another part) redirects straight to its final
 * destination rather than through an intermediate URL.
 */

// The id→slug mapping is effectively immutable, so this can cache hard. A
// slug regeneration purges the `seo:resolve:*` tag.
export const revalidate = 3600;

interface LegacyPartPageProps {
  params: Promise<{ id: string }>;
}

export default async function LegacyPartPage({ params }: LegacyPartPageProps) {
  const { id } = await params;
  const resolved = await resolvePartSegment(id);

  // Unknown id: a genuine 404 is the correct signal. Redirecting an unknown
  // product URL to the homepage or to a category would be a soft-404 and is
  // explicitly the thing not to do when a product goes away.
  if (!resolved) notFound();

  const slug = resolved.redirectToSlug ?? resolved.slug;
  // Resolvable but not yet slugged (backfill still running): 404 rather than
  // redirect to a URL that does not exist. This window closes once the
  // backfill completes, and the resolver assigns on demand in the meantime.
  if (!slug) notFound();

  permanentRedirect(partPath(slug));
}
