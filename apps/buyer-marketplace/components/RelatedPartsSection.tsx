import {
  partPath,
  relatedLinks,
  selectRelated,
  type SeoInternalLink,
} from "@repo/catalog-contracts";
import { RelatedParts } from "@/components/RelatedParts";
import { SeoLinkCloud } from "@/components/SeoLinkCloud";
import { getRelatedCandidates } from "@/lib/part-resolve";
import { toSeoPart } from "@/lib/seo";
import type { Part } from "@/lib/types";

/**
 * Related products, resolved in its own async boundary.
 *
 * This is deliberately *not* awaited by the page. The page's HTTP status
 * depends on whether the part resolves, and a status can only be set before
 * the response starts streaming — so anything the page awaits inline delays
 * the status decision. This module makes an extra API call that has no bearing
 * on that decision, so it streams in behind `<Suspense>` instead: the PDP's
 * time-to-first-byte no longer includes it, and `notFound()` upstream can
 * still return a real 404.
 *
 * The taxonomy links are rendered by the page itself, not here, because they
 * derive from the part's own fields and must be in the initial HTML — they are
 * what keeps a listing from being an orphan.
 */
export async function RelatedPartsSection({ part }: { part: Part }) {
  const candidates = await getRelatedCandidates(part);

  const scored = selectRelated(
    toSeoPart(part),
    candidates.map((candidate) => ({
      id: candidate.id,
      slug: candidate.slug ?? null,
      title: candidate.title,
      brand: candidate.brand ?? null,
      category: candidate.category ?? null,
      categoryGroup: candidate.categoryGroup ?? null,
      manufacturerPartNumber: candidate.manufacturerPartNumber ?? null,
      oeNumbers: candidate.oeNumbers ?? [],
      compatibleVehicles: candidate.compatibleVehicles ?? [],
      imageUrls: candidate.imageUrls ?? [],
    })),
    8,
  );

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const items = scored
    .map((entry) => byId.get(entry.candidate.id))
    .filter((candidate): candidate is Part => Boolean(candidate));

  const links: SeoInternalLink[] = relatedLinks(scored).slice(0, 6);

  return (
    <>
      <RelatedParts items={items} />
      <SeoLinkCloud heading="More like this" links={links} />
    </>
  );
}

/** Keeps layout stable while the related grid streams in — avoids CLS. */
export function RelatedPartsSkeleton() {
  return (
    <div className="mt-14" aria-hidden="true">
      <div className="h-6 w-40 rounded bg-slate-100" />
      <div className="mt-4 grid grid-cols-1 gap-3 xs:grid-cols-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-64 rounded-lg bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

export { partPath };
