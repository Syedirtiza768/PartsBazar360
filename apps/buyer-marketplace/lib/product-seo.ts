import type { Metadata } from "next";
import { partTypeFromLegacy } from "@repo/catalog-contracts";
import { buyerVisibleOffers, humanize, lowestOfferPrice, offerCurrency } from "@/lib/format";
import { absoluteUrl, INDEX_ROBOTS, NOINDEX_ROBOTS } from "@/lib/seo";
import { stripHtmlTags } from "@/lib/sanitize-html";
import type { Offer, Part } from "@/lib/types";

export interface ProductSEOImage {
  url: string;
  alt: string;
  sourceUrl?: string | null;
  confidence?: number | null;
}

export interface ProductSEOSpecification {
  label: string;
  value: string;
  source: string;
  confidence?: number | null;
  verified?: boolean;
}

export interface ProductSEOViewModel {
  canonical: string;
  title: string;
  metaDescription: string;
  summary: string;
  images: ProductSEOImage[];
  primaryImage?: ProductSEOImage;
  specifications: ProductSEOSpecification[];
  oeNumbers: string[];
  breadcrumbs: Array<{ name: string; item: string }>;
  indexable: boolean;
  indexabilityReasons: string[];
  robots: Metadata["robots"];
  structuredData: Record<string, unknown>;
}

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clipped(value: string, max: number): string {
  const normalized = text(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).replace(/\s+\S*$/, "").trim()}…`;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => text(value))
    .filter((value) => {
      const key = value.toUpperCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function conditionUrl(value?: string | null): string | undefined {
  const condition = text(value).toUpperCase();
  if (condition === "NEW") return "https://schema.org/NewCondition";
  if (condition === "USED") return "https://schema.org/UsedCondition";
  if (condition === "REFURBISHED" || condition === "REMANUFACTURED") {
    return "https://schema.org/RefurbishedCondition";
  }
  return undefined;
}

function makeSpecifications(part: Part, mpn: string | undefined): ProductSEOSpecification[] {
  const values: Array<[string, unknown, string]> = [
    ["Category", part.category, "catalog"],
    ["Product type", part.itemSpecifics?.inferredProductType || part.itemSpecifics?.productType, "catalog"],
    ["Brand", part.brand, "catalog"],
    ["Manufacturer", part.manufacturer && part.manufacturer !== part.brand ? part.manufacturer : null, "catalog"],
    ["Manufacturer part number", mpn, "catalog"],
    [
      "Condition",
      partTypeFromLegacy(part.partSource || part.offers?.[0]?.partSource, part.partType || part.offers?.[0]?.partType) === "GENUINE_OEM"
        ? null
        : part.qualityTier || part.offers?.[0]?.qualityTier
          ? humanize(part.qualityTier || part.offers?.[0]?.qualityTier)
          : null,
      "catalog",
    ],
    [
      "Part source",
      part.partSource || part.offers?.[0]?.partSource
        ? (part.partSource || part.offers?.[0]?.partSource) === "OEM"
          ? "OEM"
          : humanize(part.partSource || part.offers?.[0]?.partSource)
        : null,
      "catalog",
    ],
    ["Position", part.position || part.itemSpecifics?.position, "catalog"],
    ["Vehicle system", part.vehicleSystem || part.itemSpecifics?.vehicleSystem, "catalog"],
    ["Material", part.material || part.itemSpecifics?.material, "catalog"],
    ["Part type", part.itemSpecifics?.partType, "catalog"],
    ["Placement", part.itemSpecifics?.placementOnVehicle, "catalog"],
    ["Color", part.itemSpecifics?.color, "catalog"],
    ["Brand type", part.itemSpecifics?.brandType, "catalog"],
    ["Surface finish", part.itemSpecifics?.surfaceFinish, "catalog"],
    ["Country of origin", part.itemSpecifics?.countryOfOrigin, "catalog"],
    ["Warranty", part.itemSpecifics?.warranty, "catalog"],
    ["Category type", part.itemSpecifics?.categoryType, "catalog"],
    [
      "Features",
      Array.isArray(part.itemSpecifics?.features)
        ? part.itemSpecifics.features.join(", ")
        : part.itemSpecifics?.features,
      "catalog",
    ],
  ];

  return values
    .map(([label, value, fallbackSource]) => {
      const evidence = part.provenance?.[label] || part.provenance?.[label.toLowerCase()];
      return {
        label,
        value: text(value),
        source: evidence?.source || fallbackSource,
        ...(evidence?.confidence !== undefined ? { confidence: evidence.confidence } : {}),
        ...(evidence?.verified !== undefined ? { verified: evidence.verified } : {}),
      };
    })
    .filter((spec) => Boolean(spec.value));
}

function buildStructuredData(
  part: Part,
  model: Omit<ProductSEOViewModel, "structuredData">,
  offers: Offer[],
  mpn?: string,
): Record<string, unknown> {
  const primaryCondition = conditionUrl(offers[0]?.condition || part.qualityTier);
  const offerCurrencyValue = offerCurrency(offers) || undefined;
  const offerData = offers.length
    ? {
        "@type": "AggregateOffer",
        url: model.canonical,
        priceCurrency: offerCurrencyValue,
        lowPrice: lowestOfferPrice(offers),
        highPrice: Math.max(...offers.map((offer) => Number(offer.price))),
        offerCount: offers.length,
        availability: "https://schema.org/InStock",
        ...(primaryCondition ? { itemCondition: primaryCondition } : {}),
        offer: offers.slice(0, 10).map((offer) => ({
          "@type": "Offer",
          price: offer.price,
          ...(offer.currency || offerCurrencyValue
            ? { priceCurrency: offer.currency || offerCurrencyValue }
            : {}),
          availability: "https://schema.org/InStock",
          ...(conditionUrl(offer.condition) ? { itemCondition: conditionUrl(offer.condition) } : {}),
          url: model.canonical,
          seller: {
            "@type": "Organization",
            name: offer.seller?.name || offer.sellerName || "Marketplace seller",
          },
        })),
      }
    : {
        "@type": "Offer",
        url: model.canonical,
        availability: "https://schema.org/OutOfStock",
      };

  const additionalProperty = model.specifications
    .filter((spec) => !["Category", "Brand", "Manufacturer part number"].includes(spec.label))
    .map((spec) => ({
      "@type": "PropertyValue",
      name: spec.label,
      value: spec.value,
    }));

  const product: Record<string, unknown> = {
    "@type": "Product",
    name: model.title,
    description: model.summary,
    url: model.canonical,
    ...(part.brand ? { brand: { "@type": "Brand", name: part.brand } } : {}),
    ...(part.category ? { category: part.category } : {}),
    ...(model.images.length ? { image: model.images.map((image) => image.url) } : {}),
    sku: mpn || part.id,
    ...(mpn ? { mpn } : {}),
    productID: part.id,
    ...(part.material || part.itemSpecifics?.material ? { material: part.material || part.itemSpecifics?.material } : {}),
    ...(additionalProperty.length ? { additionalProperty } : {}),
    offers: offerData,
  };

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: model.breadcrumbs.map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          item: crumb.item,
        })),
      },
      product,
    ],
  };
}

/**
 * Single source of truth for the PDP's SEO and factual product presentation.
 * This deliberately derives values from catalog fields only; enrichment
 * workers may add verified fields, but this layer never invents fitment or
 * technical specifications. A product without an image remains noindex until
 * the image review gate has passed.
 */
export function buildProductSEOViewModel(part: Part, id = part.id): ProductSEOViewModel {
  const offers = buyerVisibleOffers(part.offers);
  const mpn = text(part.manufacturerPartNumber || part.oeNumbers?.[0]) || undefined;
  const canonical = absoluteUrl(`/part/${id}`);
  const title = clipped(part.title || `${part.brand || "Automotive"} part${mpn ? ` ${mpn}` : ""}`, 70);
  const rawDescription = stripHtmlTags(part.description || "");
  const summary = clipped(
    rawDescription ||
      [title, part.brand, mpn ? `Part no. ${mpn}` : null, part.category]
        .filter(Boolean)
        .join(" — "),
    220,
  );
  const metaDescription = clipped(
    [summary, offers.length ? `${offers.length} marketplace offer${offers.length === 1 ? "" : "s"}.` : null]
      .filter(Boolean)
      .join(" "),
    160,
  );
  const defaultAlt = `${part.brand ? `${part.brand} ` : ""}${title}${mpn ? ` ${mpn}` : ""} product image`;
  const mediaByUrl = new Map((part.media || []).map((media) => [media.url, media]));
  const images = unique(part.imageUrls || []).map((url) => {
    const media = mediaByUrl.get(url);
    return {
      url,
      alt: text(media?.altText) || defaultAlt,
      ...(media?.sourceUrl ? { sourceUrl: media.sourceUrl } : {}),
      ...(media?.confidence !== undefined ? { confidence: media.confidence } : {}),
    };
  });
  const normalizedMpn = text(mpn).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const meaningfulOeNumbers = unique(part.oeNumbers || []).filter(
    (number) => text(number).toUpperCase().replace(/[^A-Z0-9]/g, "") !== normalizedMpn,
  );
  const specifications = makeSpecifications(part, mpn);
  if (meaningfulOeNumbers.length) {
    specifications.splice(specifications.findIndex((spec) => spec.label === "Manufacturer part number") + 1, 0, {
      label: "OE numbers",
      value: meaningfulOeNumbers.join(", "),
      source: part.provenance?.["OE numbers"]?.source || part.provenance?.["oeNumbers"]?.source || "catalog",
      ...(part.provenance?.["OE numbers"]?.confidence !== undefined
        ? { confidence: part.provenance["OE numbers"].confidence }
        : {}),
      ...(part.provenance?.["OE numbers"]?.verified !== undefined
        ? { verified: part.provenance["OE numbers"].verified }
        : {}),
    });
  }
  const breadcrumbs = [
    { name: "Home", item: absoluteUrl("/") },
    { name: "All parts", item: absoluteUrl("/search") },
    ...(part.category
      ? [{ name: part.category, item: absoluteUrl(`/search?category=${encodeURIComponent(part.category)}`) }]
      : []),
    { name: title, item: canonical },
  ];
  const indexabilityReasons: string[] = [];
  const seoEvidence = part.itemSpecifics?._seo;
  const isLunaImagePass = seoEvidence?.source === "gpt-5.6-luna:superior-imaged-seo-v1";
  const imageConfirmed = !isLunaImagePass || (
    images.length > 0 &&
    seoEvidence?.imageAssessment === "MATCH" &&
    seoEvidence?.imageConfidence === "HIGH" &&
    seoEvidence?.imageHealth === "valid"
  );
  if (!images.length) indexabilityReasons.push("No verified product image");
  else if (!imageConfirmed) indexabilityReasons.push("Product image is awaiting exact-match review");
  if (!mpn && !part.brand && !part.category) indexabilityReasons.push("Insufficient product identity");
  const indexable = indexabilityReasons.length === 0;
  const model: Omit<ProductSEOViewModel, "structuredData"> = {
    canonical,
    title,
    metaDescription,
    summary,
    images,
    primaryImage: images[0],
    specifications,
    oeNumbers: unique(part.oeNumbers || []).filter(
      (number) => text(number).toUpperCase().replace(/[^A-Z0-9]/g, "") !== text(mpn).toUpperCase().replace(/[^A-Z0-9]/g, ""),
    ),
    breadcrumbs,
    indexable,
    indexabilityReasons,
    robots: indexable ? INDEX_ROBOTS : NOINDEX_ROBOTS,
  };
  return {
    ...model,
    structuredData: buildStructuredData(part, model, offers, mpn),
  };
}
