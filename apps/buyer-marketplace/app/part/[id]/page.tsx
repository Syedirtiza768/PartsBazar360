import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { INTERNAL_API_URL } from "@/lib/api";
import { CompatibilitySection } from "@/components/CompatibilitySection";
import { PartDetailLive } from "@/components/PartDetailLive";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import { SalvagePanel } from "@/components/SalvagePanel";
import { humanize } from "@/lib/format";
import { partTypeFromLegacy } from "@repo/catalog-contracts";
import { sanitizeProductHtml } from "@/lib/sanitize-html";
import type { Part } from "@/lib/types";
import { buildProductSEOViewModel } from "@/lib/product-seo";

// Short ISR window: PDPs are mostly catalog data. Merchant edits trigger
// on-demand revalidateTag(`part:${id}`) via /api/revalidate when configured.
// Worst-case staleness without a purge is REVALIDATE_SECONDS.
export const revalidate = 45;

interface PartPageProps {
  params: Promise<{ id: string }>;
}

async function getPart(id: string): Promise<Part | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts/${id}`, {
      next: { revalidate: 45, tags: [`part:${id}`] },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PartPageProps): Promise<Metadata> {
  const { id } = await params;
  const part = await getPart(id);
  if (!part) return { title: "Part Not Found | PartsBazar360" };

  const seo = buildProductSEOViewModel(part, id);

  return {
    title: `${seo.title} | PartsBazar360`,
    description: seo.metaDescription,
    alternates: { canonical: seo.canonical },
    robots: seo.robots,
    openGraph: {
      title: seo.title,
      description: seo.metaDescription,
      type: "website",
      url: seo.canonical,
      images: seo.primaryImage ? [{ url: seo.primaryImage.url, alt: seo.primaryImage.alt }] : undefined,
    },
    twitter: {
      card: seo.primaryImage ? "summary_large_image" : "summary",
      title: seo.title,
      description: seo.metaDescription,
      images: seo.primaryImage ? [seo.primaryImage.url] : undefined,
    },
  };
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
  const { id } = await params;
  const part = await getPart(id);

  if (!part) {
    notFound();
  }

  const seo = buildProductSEOViewModel(part, id);
  const compatibleVehicles = part.compatibleVehicles || [];
  const compatibilityRows = part.compatibilityTable || part.compatibility || [];
  const crossReferences = part.oemCrossReferences || [];
  const crossReferencesByMake = crossReferences.reduce<Record<string, typeof crossReferences>>((groups, reference) => {
    const key = reference.make || "Unresolved issuer";
    (groups[key] ||= []).push(reference);
    return groups;
  }, {});

  return (
    <div className="mx-auto max-w-content gutter pb-[calc(env(safe-area-inset-bottom,0px)+6rem)] pt-5 lg:pb-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(seo.structuredData) }} />

      <Breadcrumbs
        crumbs={[
          { href: "/", label: "Home" },
          { href: "/search", label: "All parts" },
          ...(part.category
            ? [{ href: `/search?category=${encodeURIComponent(part.category)}`, label: part.category }]
            : []),
          ...(part.brand
            ? [{ href: `/search?brand=${encodeURIComponent(part.brand)}`, label: part.brand }]
            : []),
          { label: seo.title },
        ]}
      />

      {/*
        Gallery + buy box live in a client shell that reconciles shipping /
        infographic after background enrichment; details stay as RSC children.
      */}
      <PartDetailLive part={part} imageAlt={seo.primaryImage?.alt}>
        <div className="min-w-0 space-y-10">
          <p className="text-sm leading-relaxed text-graphite-700">{seo.summary}</p>
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
              {seo.specifications.map((spec) => (
                <SpecRow key={spec.label} label={spec.label}>
                  {spec.label === "Category" ? (
                    <Link
                      href={`/search?category=${encodeURIComponent(spec.value)}`}
                      className="text-brand-700 underline-offset-2 hover:underline"
                    >
                      {spec.value}
                    </Link>
                  ) : spec.label === "Brand" ? (
                    <Link
                      href={`/search?brand=${encodeURIComponent(spec.value)}`}
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

      <div className="mt-14">
        <RecentlyViewed excludeId={part.id} />
      </div>
    </div>
  );
}
