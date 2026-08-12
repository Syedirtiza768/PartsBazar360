import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { CompatibilitySection } from "@/components/CompatibilitySection";
import { PartDetailLive } from "@/components/PartDetailLive";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import {
  RelatedPartsSection,
  RelatedPartsSkeleton,
} from "@/components/RelatedPartsSection";
import { SeoLinkCloud } from "@/components/SeoLinkCloud";
import { SalvagePanel } from "@/components/SalvagePanel";
import { humanize } from "@/lib/format";
import { partTypeFromLegacy, partPath } from "@repo/catalog-contracts";
import { sanitizeProductHtml } from "@/lib/sanitize-html";
import { getPartById, resolvePartSegment } from "@/lib/part-resolve";
import { partSeo, toMetadata } from "@/lib/seo";
import { productSpecifications } from "@/lib/product-specs";
import type { Part } from "@/lib/types";

// Short ISR window: PDPs are mostly catalog data. Merchant edits trigger
// on-demand revalidateTag(`part:${id}`) via /api/revalidate when configured.
// Worst-case staleness without a purge is REVALIDATE_SECONDS.
export const revalidate = 45;

interface PartPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Resolve a URL segment to a part, redirecting when the segment is not the
 * part's current canonical slug.
 *
 * This one function is what preserves every URL the site has ever published:
 * a retired slug, a legacy `/part/<uuid>`, and a merged-away part all arrive
 * here and leave as a single 301 to the current canonical URL. `metadataOnly`
 * suppresses the redirect during `generateMetadata`, because throwing a
 * redirect from there would discard the page render's own redirect and can
 * produce a confusing double navigation.
 */
async function loadPart(
  segment: string,
  options: { metadataOnly?: boolean } = {},
): Promise<Part | null> {
  const resolved = await resolvePartSegment(segment);
  if (!resolved) return null;

  if (resolved.redirectToSlug && resolved.redirectToSlug !== segment) {
    if (options.metadataOnly) return null;
    permanentRedirect(partPath(resolved.redirectToSlug));
  }

  const part = await getPartById(resolved.id);
  if (!part) return null;
  // The API's part payload predates slugs on some paths; the resolver is
  // authoritative, so stamp the canonical slug on before SEO generation.
  return { ...part, slug: part.slug ?? resolved.slug };
}

export async function generateMetadata({ params }: PartPageProps): Promise<Metadata> {
  const { slug } = await params;
  const part = await loadPart(slug, { metadataOnly: true });
  // A redirecting or missing segment gets noindex metadata; the page render
  // then issues the real 301 or 404.
  if (!part) {
    return {
      title: "Part not found | PartsBazar360",
      robots: { index: false, follow: true },
    };
  }
  return toMetadata(partSeo(part));
}

function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2.5 sm:grid-cols-[180px_1fr]">
      <dt className="text-sm text-graphite-600">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-slate-800">{children}</dd>
    </div>
  );
}

export default async function ProductDetailsPage({ params }: PartPageProps) {
  const { slug } = await params;
  const part = await loadPart(slug);

  if (!part) {
    notFound();
  }

  const seo = partSeo({ ...part, seo: part.seo ?? null });
  const specifications = productSpecifications(part);
  const compatibleVehicles = part.compatibleVehicles || [];
  const compatibilityRows = part.compatibilityTable || part.compatibility || [];
  const crossReferences = part.oemCrossReferences || [];
  const crossReferencesByMake = crossReferences.reduce<Record<string, typeof crossReferences>>((groups, reference) => {
    const key = reference.make || "Unresolved issuer";
    (groups[key] ||= []).push(reference);
    return groups;
  }, {});

  return (
    <article className="mx-auto max-w-content gutter pb-[calc(env(safe-area-inset-bottom,0px)+6rem)] pt-5 lg:pb-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(seo.structuredData) }} />

      {/* Trail and JSON-LD come from the same generated array, which is what
          keeps the rendered breadcrumbs and BreadcrumbList markup in step. */}
      <Breadcrumbs
        crumbs={seo.breadcrumbs.map((crumb, index) => ({
          ...(index < seo.breadcrumbs.length - 1 ? { href: crumb.path } : {}),
          label: crumb.name,
        }))}
      />

      {/*
        Gallery + buy box live in a client shell that reconciles shipping /
        infographic after background enrichment; details stay as RSC children.
      */}
      <PartDetailLive part={part} imageAlt={seo.primaryImage?.alt} heading={seo.h1}>
        <div className="min-w-0 space-y-10">
          <p className="text-sm leading-relaxed text-graphite-700">{seo.description}</p>
          {(part.salvageUnits?.length || part.partType === "SALVAGE_OEM") && (
            <SalvagePanel units={part.salvageUnits || []} />
          )}

          {/* Product description from enrichment — stored as eBay seller HTML */}
          {part.description && (
            <section aria-labelledby="description-heading">
              <h2 id="description-heading" className="text-lg font-bold tracking-tight text-slate-900">
                Product description
              </h2>
              <div
                className="prose prose-sm mt-3 max-w-none text-slate-700 leading-relaxed [&_img]:rounded-lg [&_img]:max-w-full [&_table]:text-xs [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold"
                dangerouslySetInnerHTML={{ __html: sanitizeProductHtml(part.description) }}
              />
              {part.itemSpecifics?.compatibilityNote && (
                <p className="mt-3 text-xs leading-relaxed text-graphite-600 italic">
                  {part.itemSpecifics.compatibilityNote}
                </p>
              )}
            </section>
          )}

          {/* Detail bullets from enrichment */}
          {part.itemSpecifics?.detailBullets && (() => {
            // Enrichment sources disagree on delimiter: some join bullets with
            // ' | ', others with a literal newline. Split on either.
            const rawBullets = String(part.itemSpecifics.detailBullets)
              .split(/\s*\|\s*|\n+/)
              .map((b) => b.trim())
              .filter(Boolean);
            // Strip any stored Condition/Quality Tier bullet — the page
            // computes its own authoritative condition bullet below (or
            // suppresses it for Genuine OEM), so a raw stored one is always
            // redundant and can contradict it (e.g. "Genuine OEM" badge next
            // to a stored "Quality Tier: USED" bullet).
            const filtered = rawBullets.filter(
              (b) => !/^condition\b|^quality\s*tier\s*:/i.test(b),
            );
            // Suppress condition bullet entirely for Genuine OEM
            const resolvedPartType = partTypeFromLegacy(part.partSource || part.offers?.[0]?.partSource, part.partType || part.offers?.[0]?.partType);
            const isGenuineOem = resolvedPartType === 'GENUINE_OEM';
            const condition = humanize(part.qualityTier || part.offers?.[0]?.qualityTier || '');
            const partSource = part.partSource || part.offers?.[0]?.partSource || '';
            const conditionBullet = (!isGenuineOem && condition)
              ? `Condition: ${condition}${partSource ? ` / ${humanize(partSource)}` : ''}`
              : null;
            const bullets = conditionBullet
              ? [...filtered.slice(0, 2), conditionBullet, ...filtered.slice(2)]
              : filtered;
            return bullets.length > 0 ? (
              <section aria-labelledby="details-heading">
                <h2 id="details-heading" className="text-lg font-bold tracking-tight text-slate-900">
                  Key details
                </h2>
                <ul className="mt-3 space-y-1.5">
                  {bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null;
          })()}

          {/* Fitment hints from enrichment */}
          {part.itemSpecifics?.fitmentHints && (
            <section aria-labelledby="fitment-hints-heading">
              <h2 id="fitment-hints-heading" className="text-lg font-bold tracking-tight text-slate-900">
                Fitment information
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {String(part.itemSpecifics.fitmentHints).split(',').map((hint) => hint.trim()).filter(Boolean).map((hint, i) => (
                  <span key={i} className="inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-200">
                    {hint}
                  </span>
                ))}
              </div>
            </section>
          )}

          <CompatibilitySection rows={compatibilityRows} compatibleVehicles={compatibleVehicles} />

          {crossReferences.length > 0 && (
            <section aria-labelledby="cross-reference-heading">
              <h2 id="cross-reference-heading" className="text-lg font-bold tracking-tight text-slate-900">
                Replaces or cross-references these OEM numbers
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {Object.entries(crossReferencesByMake).map(([make, references]) => (
                  <div key={make} className="border border-stone-200 bg-white p-4">
                    <h3 className="text-sm font-bold text-slate-900">{make}</h3>
                    <ul className="mt-2 space-y-1.5">
                      {references.map((reference) => (
                        <li key={`${make}-${reference.normalizedNumber}`} className="part-number text-sm text-slate-700">{reference.number}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-graphite-600">
                An OEM-number cross-reference does not by itself confirm fitment for every vehicle configuration. Select your vehicle or ask the seller before ordering.
              </p>
            </section>
          )}

          {/* Specifications */}
          <section aria-labelledby="specs-heading">
            <h2 id="specs-heading" className="text-lg font-bold tracking-tight text-slate-900">
              Technical details
            </h2>
            <dl className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-5 py-1.5">
              {specifications.map((spec) => (
                <SpecRow key={spec.label} label={spec.label}>
                  {/* Category and brand link to their taxonomy landing pages,
                      not to a filtered search URL — the landing page is the
                      indexable destination, so this is where a crawler should
                      be pointed. */}
                  {spec.href ? (
                    <Link
                      href={spec.href}
                      className="text-brand-700 underline-offset-2 hover:underline"
                    >
                      {spec.value}
                    </Link>
                  ) : (
                    <span className={spec.label.toLowerCase().includes("number") || spec.label === "OE numbers" ? "part-number break-all" : undefined}>
                      {spec.value}
                    </span>
                  )}
                </SpecRow>
              ))}

            </dl>
            <p className="mt-3 text-xs leading-relaxed text-graphite-600">
              Photos show the actual item where provided by the seller. Report inaccurate listings{" "}
              <Link
                href={`/support?partId=${part.id}&category=GENERAL&subject=${encodeURIComponent(
                  `Report listing: ${part.title}`,
                )}`}
                className="font-medium text-brand-600 underline-offset-2 hover:underline"
              >
                to our team
              </Link>
              .
            </p>
          </section>
        </div>
      </PartDetailLive>

      {/* Related parts and taxonomy links are rendered as real server-side
          anchors, so a new listing is reachable by a crawler from the moment
          it is published rather than only through search. */}
      {/* Taxonomy links are in the initial HTML — they are what stops a new
          listing being an orphan. Related products stream in behind Suspense
          because their extra API call must not delay the page's HTTP status
          (a status can only be set before the response starts streaming). */}
      <SeoLinkCloud heading="Browse related categories" links={seo.internalLinks} />

      <Suspense fallback={<RelatedPartsSkeleton />}>
        <RelatedPartsSection part={part} />
      </Suspense>

      <div className="mt-14">
        <RecentlyViewed excludeId={part.id} />
      </div>
    </article>
  );
}
