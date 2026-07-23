import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { INTERNAL_API_URL, SITE_URL } from "@/lib/api";
import { ImageGallery } from "@/components/ImageGallery";
import { CompatibilitySection } from "@/components/CompatibilitySection";
import { BuyBox, StickyMobileBar } from "@/components/BuyBox";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import { SalvagePanel } from "@/components/SalvagePanel";
import { lowestOfferPrice, offerCurrency, humanize } from "@/lib/format";
import type { Part } from "@/lib/types";

// PDPs must always reflect the current DB state — never a cached page that
// could serve a stale (deleted/no-offer) listing. force-dynamic opts out of
// the Next.js Full Route Cache so notFound() returns a live 404 when the API
// reports the part as gone.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PartPageProps {
  params: Promise<{ id: string }>;
}

async function getPart(id: string): Promise<Part | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts/${id}`, { cache: "no-store" });
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

  const price = lowestOfferPrice(part.offers);
  const currency = offerCurrency(part.offers);
  const description = `${part.title}${part.brand ? ` — ${part.brand}` : ""}${part.category ? ` (${part.category})` : ""}. ${part.offers.length} offer(s) from verified sellers${price && currency ? `, starting at ${currency} ${price.toFixed(2)}` : ""}.`;
  const image = part.imageUrls?.[0];

  return {
    title: `${part.title} | PartsBazar360`,
    description,
    alternates: { canonical: `${SITE_URL}/part/${id}` },
    openGraph: {
      title: part.title,
      description,
      type: "website",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: part.title,
      description,
      images: image ? [image] : undefined,
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

  const images = part.imageUrls || [];
  const compatibleVehicles = part.compatibleVehicles || [];
  const compatibilityRows = part.compatibilityTable || part.compatibility || [];
  const crossReferences = part.oemCrossReferences || [];
  const crossReferencesByMake = crossReferences.reduce<Record<string, typeof crossReferences>>((groups, reference) => {
    const key = reference.make || "Unresolved issuer";
    (groups[key] ||= []).push(reference);
    return groups;
  }, {});

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: part.title,
    brand: part.brand ? { "@type": "Brand", name: part.brand } : undefined,
    category: part.category || undefined,
    image: images.length > 0 ? images : undefined,
    sku: part.id,
    mpn: part.oeNumbers?.[0] || undefined,
    offers:
      part.offers.length > 0
        ? {
            "@type": "AggregateOffer",
            priceCurrency: offerCurrency(part.offers) ?? undefined,
            lowPrice: lowestOfferPrice(part.offers),
            highPrice: Math.max(...part.offers.map((o) => o.price)),
            offerCount: part.offers.length,
            availability: "https://schema.org/InStock",
          }
        : undefined,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Breadcrumbs
        crumbs={[
          { href: "/", label: "Home" },
          { href: "/search", label: "All parts" },
          ...(part.category
            ? [{ href: `/search?category=${encodeURIComponent(part.category)}`, label: part.category }]
            : []),
          { label: part.title },
        ]}
      />

      {/*
        Grid placement keeps a sensible mobile order (gallery → buy box →
        details) while the buy box occupies a sticky right rail on desktop.
      */}
      <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <ImageGallery images={images} title={part.title} />
        </div>

        <aside className="min-w-0 self-start lg:sticky lg:top-40 lg:row-span-2" aria-label="Purchase options">
          <BuyBox part={part} />
        </aside>

        <div className="min-w-0 space-y-10">
          {(part.salvageUnits?.length || part.partType === "SALVAGE_OEM") && (
            <SalvagePanel units={part.salvageUnits || []} />
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
              {part.brand && <SpecRow label="Brand">{part.brand}</SpecRow>}
              {part.manufacturer && part.manufacturer !== part.brand && (
                <SpecRow label="Manufacturer">{part.manufacturer}</SpecRow>
              )}
              {part.category && <SpecRow label="Category">{part.category}</SpecRow>}
              {(part.qualityTier || part.offers?.[0]?.qualityTier) && (
                <SpecRow label="Condition tier">
                  {humanize(part.qualityTier || part.offers?.[0]?.qualityTier)}
                </SpecRow>
              )}
              {(part.partSource || part.offers?.[0]?.partSource) && (
                <SpecRow label="Part source">
                  {(part.partSource || part.offers?.[0]?.partSource) === "OEM"
                    ? "Genuine OEM"
                    : humanize(part.partSource || part.offers?.[0]?.partSource)}
                </SpecRow>
              )}
              {part.weight ? <SpecRow label="Weight">{part.weight} kg</SpecRow> : null}
              {part.oeNumbers && part.oeNumbers.length > 0 && (
                <SpecRow label="OE numbers">
                  <span className="part-number break-all">{part.oeNumbers.join(", ")}</span>
                </SpecRow>
              )}
              {part.ebayItemId && (
                <SpecRow label="Marketplace item ID">
                  <span className="part-number">{part.ebayItemId}</span>
                </SpecRow>
              )}

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
      </div>

      <div className="mt-14">
        <RecentlyViewed excludeId={part.id} />
      </div>

      <StickyMobileBar part={part} />
    </div>
  );
}
