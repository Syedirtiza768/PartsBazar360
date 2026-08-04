import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { INTERNAL_API_URL } from "@/lib/api";
import { absoluteUrl, getSiteUrl } from "@/lib/seo";
import { CompatibilitySection } from "@/components/CompatibilitySection";
import { PartDetailLive } from "@/components/PartDetailLive";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import { SalvagePanel } from "@/components/SalvagePanel";
import { buyerVisibleOffers, lowestOfferPrice, offerCurrency, humanize } from "@/lib/format";
import type { Part } from "@/lib/types";

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

  const offers = buyerVisibleOffers(part.offers);
  const price = lowestOfferPrice(offers);
  const currency = offerCurrency(offers);
  const mpn = part.manufacturerPartNumber || part.oeNumbers?.[0];
  const description = [
    part.title,
    part.brand ? `${part.brand}` : null,
    mpn ? `Part no. ${mpn}` : null,
    part.category ? `${part.category}` : null,
    offers.length > 0
      ? `${offers.length} offer${offers.length === 1 ? "" : "s"} from marketplace sellers${price && currency ? `, from ${currency} ${price.toFixed(2)}` : ""}`
      : "Currently unavailable from marketplace sellers",
  ]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 160);
  const image = part.imageUrls?.[0];
  const canonical = absoluteUrl(`/part/${id}`);

  return {
    title: `${part.title} | PartsBazar360`,
    description,
    alternates: { canonical },
    openGraph: {
      title: part.title,
      description,
      type: "website",
      url: canonical,
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

  const offers = buyerVisibleOffers(part.offers);
  const mpn = part.manufacturerPartNumber || part.oeNumbers?.[0];
  const productUrl = absoluteUrl(`/part/${id}`);
  const breadcrumbItems = [
    { name: "Home", item: absoluteUrl("/") },
    { name: "All parts", item: absoluteUrl("/search") },
    ...(part.category
      ? [
          {
            name: part.category,
            item: `${getSiteUrl()}/search?category=${encodeURIComponent(part.category)}`,
          },
        ]
      : []),
    { name: part.title, item: productUrl },
  ];

  const conditionMap: Record<string, string> = {
    NEW: "https://schema.org/NewCondition",
    USED: "https://schema.org/UsedCondition",
    REFURBISHED: "https://schema.org/RefurbishedCondition",
    REMANUFACTURED: "https://schema.org/RefurbishedCondition",
  };
  const primaryCondition =
    conditionMap[(offers[0]?.condition || part.qualityTier || "").toUpperCase()] ||
    "https://schema.org/UsedCondition";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbItems.map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          item: crumb.item,
        })),
      },
      {
        "@type": "Product",
        name: part.title,
        url: productUrl,
        brand: part.brand ? { "@type": "Brand", name: part.brand } : undefined,
        category: part.category || undefined,
        image: images.length > 0 ? images : undefined,
        sku: part.manufacturerPartNumber || part.id,
        mpn: mpn || undefined,
        productID: part.id,
        material: part.partSource === "OEM" ? "Genuine OEM" : part.partSource || undefined,
        offers:
          offers.length > 0
            ? {
                "@type": "AggregateOffer",
                url: productUrl,
                priceCurrency: offerCurrency(offers) ?? "USD",
                lowPrice: lowestOfferPrice(offers),
                highPrice: Math.max(...offers.map((o) => o.price)),
                offerCount: offers.length,
                availability: "https://schema.org/InStock",
                itemCondition: primaryCondition,
                offer: offers.slice(0, 10).map((o) => ({
                  "@type": "Offer",
                  price: o.price,
                  priceCurrency: o.currency || offerCurrency(offers) || "USD",
                  availability: "https://schema.org/InStock",
                  itemCondition:
                    conditionMap[(o.condition || "").toUpperCase()] || primaryCondition,
                  url: productUrl,
                  seller: {
                    "@type": "Organization",
                    name: o.seller?.name || o.sellerName || "Marketplace seller",
                  },
                })),
              }
            : {
                "@type": "Offer",
                url: productUrl,
                availability: "https://schema.org/OutOfStock",
                priceCurrency: "USD",
              },
      },
    ],
  };

  return (
    <div className="mx-auto max-w-content gutter pb-[calc(env(safe-area-inset-bottom,0px)+6rem)] pt-5 lg:pb-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

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
          { label: part.title },
        ]}
      />

      {/*
        Gallery + buy box live in a client shell that reconciles shipping /
        infographic after background enrichment; details stay as RSC children.
      */}
      <PartDetailLive part={part}>
        <div className="min-w-0 space-y-10">
          {(part.salvageUnits?.length || part.partType === "SALVAGE_OEM") && (
            <SalvagePanel units={part.salvageUnits || []} />
          )}

          {/* Product description from enrichment */}
          {part.description && (
            <section aria-labelledby="description-heading">
              <h2 id="description-heading" className="text-lg font-bold tracking-tight text-slate-900">
                Product description
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-700">
                {part.description}
              </p>
              {part.itemSpecifics?.compatibilityNote && (
                <p className="mt-3 text-xs leading-relaxed text-graphite-600 italic">
                  {part.itemSpecifics.compatibilityNote}
                </p>
              )}
            </section>
          )}

          {/* Detail bullets from enrichment */}
          {part.itemSpecifics?.detailBullets && (() => {
            const rawBullets = String(part.itemSpecifics.detailBullets).split(' | ').filter(Boolean);
            // Strip hardcoded condition bullet (e.g. "Condition/source: Used / OEM")
            // and replace with dynamic value from DB
            const filtered = rawBullets.filter((b) => !/^condition\s*\/\s*source\s*:/i.test(b.trim()));
            const condition = humanize(part.qualityTier || part.offers?.[0]?.qualityTier || '');
            const partSource = part.partSource || part.offers?.[0]?.partSource || '';
            const conditionBullet = condition
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
              {part.category && (
                <SpecRow label="Category">
                  <Link
                    href={`/search?category=${encodeURIComponent(part.category)}`}
                    className="text-brand-700 underline-offset-2 hover:underline"
                  >
                    {part.category}
                  </Link>
                </SpecRow>
              )}
              {(part.itemSpecifics?.inferredProductType || part.itemSpecifics?.productType) && (
                <SpecRow label="Product type">
                  {String(part.itemSpecifics.inferredProductType || part.itemSpecifics.productType)}
                </SpecRow>
              )}
              {part.brand && (
                <SpecRow label="Brand">
                  <Link
                    href={`/search?brand=${encodeURIComponent(part.brand)}`}
                    className="text-brand-700 underline-offset-2 hover:underline"
                  >
                    {part.brand}
                  </Link>
                </SpecRow>
              )}
              {part.manufacturer && part.manufacturer !== part.brand && (
                <SpecRow label="Manufacturer">{part.manufacturer}</SpecRow>
              )}
              {(part.qualityTier || part.offers?.[0]?.qualityTier) && (
                <SpecRow label="Condition">{humanize(part.qualityTier || part.offers?.[0]?.qualityTier)}</SpecRow>
              )}
              {(part.partSource || part.offers?.[0]?.partSource) && (
                <SpecRow label="Part source">
                  {(part.partSource || part.offers?.[0]?.partSource) === "OEM"
                    ? "Genuine OEM"
                    : humanize(part.partSource || part.offers?.[0]?.partSource)}
                </SpecRow>
              )}
              {part.weight ? <SpecRow label="Weight">{part.weight} kg</SpecRow> : null}
              {part.shipping && (
                <SpecRow label="Billable weight">
                  {part.shipping.billableWeightKg} kg
                  {part.shipping.state !== "exact" ? " (estimate)" : ""}
                </SpecRow>
              )}
              {part.oeNumbers && part.oeNumbers.length > 0 && (
                <SpecRow label="OE numbers">
                  <span className="part-number break-all">{part.oeNumbers.join(", ")}</span>
                </SpecRow>
              )}
              {(part.position || part.itemSpecifics?.position) && (
                <SpecRow label="Position">{part.position || part.itemSpecifics?.position}</SpecRow>
              )}
              {(part.vehicleSystem || part.itemSpecifics?.vehicleSystem) && (
                <SpecRow label="Vehicle system">{part.vehicleSystem || part.itemSpecifics?.vehicleSystem}</SpecRow>
              )}
              {(part.material || part.itemSpecifics?.material) && (
                <SpecRow label="Material">{part.material || part.itemSpecifics?.material}</SpecRow>
              )}
              {part.itemSpecifics?.partType && (
                <SpecRow label="Part type">{part.itemSpecifics.partType}</SpecRow>
              )}
              {part.itemSpecifics?.placementOnVehicle && (
                <SpecRow label="Placement">{part.itemSpecifics.placementOnVehicle}</SpecRow>
              )}
              {part.itemSpecifics?.color && (
                <SpecRow label="Color">{part.itemSpecifics.color}</SpecRow>
              )}
              {part.itemSpecifics?.brandType && (
                <SpecRow label="Brand type">{part.itemSpecifics.brandType}</SpecRow>
              )}
              {part.itemSpecifics?.surfaceFinish && (
                <SpecRow label="Surface finish">{part.itemSpecifics.surfaceFinish}</SpecRow>
              )}
              {part.itemSpecifics?.countryOfOrigin && (
                <SpecRow label="Country of origin">{part.itemSpecifics.countryOfOrigin}</SpecRow>
              )}
              {part.itemSpecifics?.warranty && (
                <SpecRow label="Warranty">{part.itemSpecifics.warranty}</SpecRow>
              )}
              {part.itemSpecifics?.categoryType && (
                <SpecRow label="Category type">{part.itemSpecifics.categoryType}</SpecRow>
              )}
              {part.itemSpecifics?.features && (Array.isArray(part.itemSpecifics.features) ? part.itemSpecifics.features.length > 0 : true) && (
                <SpecRow label="Features">
                  {Array.isArray(part.itemSpecifics.features) ? part.itemSpecifics.features.join(', ') : part.itemSpecifics.features}
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
      </PartDetailLive>

      <div className="mt-14">
        <RecentlyViewed excludeId={part.id} />
      </div>
    </div>
  );
}
