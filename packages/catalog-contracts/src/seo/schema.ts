/**
 * JSON-LD generation.
 *
 * The governing rule is Google's structured-data policy: markup must describe
 * what is actually on the page, and must not state anything the site does not
 * know. Consequently **every property here is conditional on its source field
 * being present.** There is no default price, no default rating, no default
 * availability, and no `aggregateRating` at all — the platform does not
 * collect reviews, so emitting one would be fabricated markup and a manual-
 * action risk.
 *
 * `omitEmpty` is applied at the end of each builder so a missing attribute
 * disappears from the graph rather than serialising as `null`.
 */

import { seoConfig } from './config';
import { availabilityFor, purchasableOffers } from './indexability';
import { primaryPartNumber } from './slug';
import {
  humanizeToken,
  normalizeIdentifier,
  text,
  titleCase,
  uniqueStrings,
} from './text';
import { absoluteUrl } from './url';
import type {
  SeoBreadcrumb,
  SeoImage,
  SeoOfferInput,
  SeoPartInput,
  SeoTaxonomyInput,
} from './types';

/** Recursively drop null/undefined/empty values so no hole reaches the page. */
export function omitEmpty<T>(value: T): T {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((entry) => omitEmpty(entry))
      .filter(
        (entry) =>
          entry !== undefined &&
          entry !== null &&
          entry !== '' &&
          !(Array.isArray(entry) && entry.length === 0),
      );
    return cleaned as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = omitEmpty(raw);
      if (cleaned === undefined || cleaned === null || cleaned === '') continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      if (
        typeof cleaned === 'object' &&
        !Array.isArray(cleaned) &&
        Object.keys(cleaned as object).length === 0
      ) {
        continue;
      }
      out[key] = cleaned;
    }
    return out as unknown as T;
  }
  return value;
}

/** Map a catalog condition to a schema.org condition, or nothing. */
export function conditionUrl(value: unknown): string | undefined {
  const condition = text(value).toUpperCase().replace(/[\s-]+/g, '_');
  if (!condition) return undefined;
  if (condition === 'NEW') return 'https://schema.org/NewCondition';
  if (condition === 'USED' || condition === 'SALVAGE' || condition === 'SALVAGE_OEM') {
    return 'https://schema.org/UsedCondition';
  }
  if (condition === 'REFURBISHED' || condition === 'REMANUFACTURED') {
    return 'https://schema.org/RefurbishedCondition';
  }
  if (condition === 'FOR_PARTS' || condition === 'DAMAGED') {
    return 'https://schema.org/DamagedCondition';
  }
  return undefined;
}

function priceOf(offer: SeoOfferInput): number | undefined {
  const price = Number(offer?.price);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

/**
 * `Offer` / `AggregateOffer`.
 *
 * A single purchasable offer becomes an `Offer`; several become an
 * `AggregateOffer` with the real low/high/count. When nothing is purchasable
 * the offer node still exists — with `OutOfStock` and no price — because
 * omitting `offers` entirely would fail Product validation while inventing a
 * price would be worse.
 */
export function offersJsonLd(
  part: SeoPartInput,
  canonical: string,
): Record<string, unknown> {
  const { defaultCurrency } = seoConfig();
  const offers = purchasableOffers(part);
  const availability = availabilityFor(part);

  if (!offers.length) {
    return omitEmpty({
      '@type': 'Offer',
      url: canonical,
      availability,
      itemCondition: conditionUrl(part.qualityTier),
    });
  }

  const currency =
    text(offers.find((offer) => text(offer.currency))?.currency) || defaultCurrency;

  const buildOffer = (offer: SeoOfferInput): Record<string, unknown> => {
    const price = priceOf(offer);
    const shipping = Number(offer.shippingPrice);
    return omitEmpty({
      '@type': 'Offer',
      url: canonical,
      price: price !== undefined ? price.toFixed(2) : undefined,
      priceCurrency: text(offer.currency) || currency,
      availability,
      itemCondition:
        conditionUrl(offer.condition) ||
        conditionUrl(offer.qualityTier) ||
        conditionUrl(part.qualityTier),
      seller: text(offer.sellerName)
        ? { '@type': 'Organization', name: text(offer.sellerName) }
        : undefined,
      // Only emitted when the seller publishes a real rate. A guessed
      // shipping figure is exactly the kind of claim Merchant listings
      // penalise, so an unknown rate is left unsaid.
      shippingDetails:
        Number.isFinite(shipping) && shipping >= 0
          ? omitEmpty({
              '@type': 'OfferShippingDetails',
              shippingRate: {
                '@type': 'MonetaryAmount',
                value: shipping.toFixed(2),
                currency: text(offer.shippingCurrency) || text(offer.currency) || currency,
              },
              shippingDestination: text(offer.shipsFromCountry)
                ? {
                    '@type': 'DefinedRegion',
                    addressCountry: text(offer.shipsFromCountry),
                  }
                : undefined,
            })
          : undefined,
    });
  };

  if (offers.length === 1) return buildOffer(offers[0]!);

  const prices = offers
    .map(priceOf)
    .filter((price): price is number => price !== undefined);

  return omitEmpty({
    '@type': 'AggregateOffer',
    url: canonical,
    priceCurrency: currency,
    lowPrice: prices.length ? Math.min(...prices).toFixed(2) : undefined,
    highPrice: prices.length ? Math.max(...prices).toFixed(2) : undefined,
    offerCount: offers.length,
    availability,
    // Cap the enumerated offers: a part with 40 sellers would otherwise ship
    // 40 nested nodes of near-identical markup on every request.
    offers: offers.slice(0, 10).map(buildOffer),
  });
}

/**
 * `additionalProperty` entries from the catalog's structured specifics.
 *
 * Only fields the catalog actually stores are emitted, and pipeline
 * bookkeeping keys (`_seo`, `_enrichment`) are excluded — they are not
 * product attributes and would leak internal state into public markup.
 */
export function specificationProperties(
  part: SeoPartInput,
): Array<Record<string, unknown>> {
  const named: Array<[string, unknown]> = [
    ['Part type', part.partType && humanizeToken(part.partType)],
    ['Part source', part.partSource && humanizeToken(part.partSource)],
    ['Condition', part.qualityTier && humanizeToken(part.qualityTier)],
    ['Position', part.position],
    ['Vehicle system', part.vehicleSystem],
    ['Material', part.material],
  ];

  const specifics = Object.entries(part.itemSpecifics || {})
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => {
      const label = titleCase(key.replace(/([a-z])([A-Z])/g, '$1 $2'));
      const rendered = Array.isArray(value)
        ? uniqueStrings(value).join(', ')
        : text(value);
      return [label, rendered] as [string, unknown];
    });

  const seen = new Set<string>();
  return [...named, ...specifics]
    .filter(([label, value]) => {
      const rendered = text(value);
      if (!rendered) return false;
      const key = text(label).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40)
    .map(([label, value]) => ({
      '@type': 'PropertyValue',
      name: text(label),
      value: text(value),
    }));
}

/**
 * `Product` node.
 *
 * `isAccessoryOrSparePartFor` carries the fitment data as real vocabulary
 * rather than prose, which is the correct way to express "this part fits
 * these vehicles" — and it is only emitted when fitment rows exist.
 */
export function productJsonLd(
  part: SeoPartInput,
  options: {
    canonical: string;
    name: string;
    description: string;
    images: SeoImage[];
  },
): Record<string, unknown> {
  const { canonical, name, description, images } = options;
  const mpn = primaryPartNumber(part);
  const brand = text(part.brand) || text(part.manufacturer);

  // OE numbers other than the MPN are genuine alternate identifiers.
  const alternateNumbers = uniqueStrings(part.oeNumbers || []).filter(
    (number) => normalizeIdentifier(number) !== normalizeIdentifier(mpn),
  );

  const vehicles = (part.compatibleVehicles || [])
    .map((vehicle) =>
      omitEmpty({
        '@type': 'Vehicle',
        manufacturer: text(vehicle?.make)
          ? { '@type': 'Organization', name: titleCase(vehicle?.make) }
          : undefined,
        model: titleCase(vehicle?.model) || undefined,
        vehicleModelDate:
          Number(vehicle?.startYear) > 0 ? String(vehicle?.startYear) : undefined,
      }),
    )
    .filter((vehicle) => Object.keys(vehicle).length > 1)
    // A part fitting hundreds of configurations would bloat the payload;
    // the on-page compatibility table remains the complete record.
    .slice(0, 25);

  return omitEmpty({
    '@type': 'Product',
    '@id': `${canonical}#product`,
    name,
    description,
    url: canonical,
    // `sku` is the platform's own identifier; `mpn` is the manufacturer's.
    // Conflating them (the previous implementation used the MPN as the SKU)
    // makes two different sellers' listings look like the same SKU.
    sku: part.id,
    mpn: mpn || undefined,
    productID: part.id,
    brand: brand ? { '@type': 'Brand', name: titleCase(brand) } : undefined,
    manufacturer:
      text(part.manufacturer) && text(part.manufacturer) !== brand
        ? { '@type': 'Organization', name: titleCase(part.manufacturer) }
        : undefined,
    category: text(part.category) || undefined,
    image: images.map((image) => image.url),
    material: text(part.material) || undefined,
    itemCondition: conditionUrl(part.qualityTier),
    identifier: alternateNumbers.length ? alternateNumbers : undefined,
    isAccessoryOrSparePartFor: vehicles.length ? vehicles : undefined,
    additionalProperty: specificationProperties(part),
    offers: offersJsonLd(part, canonical),
  });
}

/**
 * `ItemList` for a taxonomy page — the correct vocabulary for "this page is a
 * list of these products", and what lets a collection page's items be
 * understood without inventing a Product node per tile.
 */
export function itemListJsonLd(
  items: Array<{ url: string; name: string; image?: string; position?: number }>,
  options: { canonical: string; startPosition?: number },
): Record<string, unknown> {
  const start = options.startPosition ?? 1;
  return omitEmpty({
    '@type': 'ItemList',
    '@id': `${options.canonical}#itemlist`,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: item.position ?? start + index,
      url: item.url,
      name: item.name,
    })),
  });
}

/** `CollectionPage` node describing a taxonomy landing page itself. */
export function collectionPageJsonLd(
  node: SeoTaxonomyInput,
  options: { canonical: string; name: string; description: string },
): Record<string, unknown> {
  const { siteUrl, siteName } = seoConfig();
  return omitEmpty({
    '@type': 'CollectionPage',
    '@id': `${options.canonical}#page`,
    url: options.canonical,
    name: options.name,
    description: options.description,
    isPartOf: { '@id': `${siteUrl}/#website` },
    publisher: { '@id': `${siteUrl}/#organization` },
    about:
      node.kind === 'brand'
        ? { '@type': 'Brand', name: titleCase(node.name) }
        : undefined,
  });
}

/**
 * Site-wide `Organization` + `WebSite` nodes. Emitted once, from the root
 * layout, and referenced by `@id` everywhere else so the graph stays a graph
 * rather than repeating the publisher on every page.
 */
export function siteJsonLd(): Record<string, unknown> {
  const { siteUrl, siteName, organizationName } = seoConfig();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      omitEmpty({
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: organizationName,
        url: absoluteUrl('/'),
        logo: absoluteUrl(seoConfig().fallbackOgImage),
        description:
          'Motor parts marketplace focused on fitment evidence, condition disclosure, and seller-visible terms.',
      }),
      omitEmpty({
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: siteName,
        url: absoluteUrl('/'),
        publisher: { '@id': `${siteUrl}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${siteUrl}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      }),
    ],
  };
}

/** Assemble a page-level `@graph` from already-built nodes. */
export function graph(
  nodes: Array<Record<string, unknown> | null | undefined>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes.filter(
      (node): node is Record<string, unknown> =>
        Boolean(node) && Object.keys(node!).length > 0,
    ),
  };
}

/** Re-exported for the breadcrumb builder's convenience. */
export type { SeoBreadcrumb };
