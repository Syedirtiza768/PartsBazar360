/**
 * Buyer-facing offer visibility for search/browse cards.
 * OpenSearch may still carry legacy inactive-seller duplicates until reindex.
 */

import {
  canonicalizeCatalogBrand,
  canonicalizeVehicleMakes,
} from '../catalog-import/catalog-identity.util';
import { isDeadCatalogImagePath } from './image-url.util';

const HIDDEN_SELLER_IDS = new Set(['seed-febest-inventory-supplier']);

const HIDDEN_SELLER_NAME_RE = /febest\s+inventory\s+supplier/i;

export const SUPERIOR_SELLER_ID = 'seller-superior-auto-parts';
const SUPERIOR_SELLER_NAME_RE = /superior\s+auto\s+parts/i;

/**
 * Sellers Superior outranks on the same part, regardless of price.
 *
 * Matched by name as well as ID on purpose: the seed config assigns slug IDs,
 * but sellers created through the RealTrack importer get a UUID instead, so
 * production carries "Blackline Auto Parts" under a UUID and the slug
 * `seller-blackline-auto-parts` matches nothing. An ID-only rule silently
 * suppressed Salvage while letting every Blackline offer through.
 */
export const SUPERFLOUS_SELLER_IDS = new Set([
  'seller-blackline-auto-parts',
  'seller-salvage-auto-parts',
  '21924d3c-b345-4dcd-900c-b4bcf92b01c0', // Blackline Auto Parts (production)
]);
const SUPERFLOUS_SELLER_NAME_RE = /\b(?:blackline|salvage)\s+auto\s+parts\b/i;

type OfferSellerLike = {
  sellerId?: string | null;
  sellerName?: string | null;
  seller?: { name?: string | null } | null;
};

function sellerNameOf(offer: OfferSellerLike | null | undefined): string {
  return offer?.sellerName || offer?.seller?.name || '';
}

export function isSuperiorOffer(offer: OfferSellerLike): boolean {
  return (
    offer?.sellerId === SUPERIOR_SELLER_ID ||
    SUPERIOR_SELLER_NAME_RE.test(sellerNameOf(offer))
  );
}

export function isOutrankedBySuperior(offer: OfferSellerLike): boolean {
  return (
    SUPERFLOUS_SELLER_IDS.has(offer?.sellerId ?? '') ||
    SUPERFLOUS_SELLER_NAME_RE.test(sellerNameOf(offer))
  );
}

/**
 * Superior takes priority: when a part has a Superior offer, Blackline and
 * Salvage offers on that same part are not shown to buyers. Applied at index
 * time (so price sort, price filters and the source-tag facet agree with the
 * rendered card) and again at read time (so stale OpenSearch docs written
 * before a reindex still obey the rule).
 */
export function applySuperiorPriority<T extends OfferSellerLike>(
  offers: T[],
): T[] {
  if (!offers.some(isSuperiorOffer)) return offers;
  return offers.filter((offer) => !isOutrankedBySuperior(offer));
}

export type IndexedOfferLike = {
  sellerId?: string | null;
  sellerName?: string | null;
  status?: string | null;
  price?: number | null;
  sourceTag?: string | null;
  seller?: { name?: string | null; onboardingStatus?: string | null } | null;
  [key: string]: unknown;
};

export type SearchItemLike = {
  id?: string;
  brand?: string | null;
  makes?: string[] | null;
  offers?: IndexedOfferLike[] | null;
  minPrice?: number | null;
  [key: string]: unknown;
};

export type OfferFilterConstraints = {
  sourceTags?: string[];
  minPrice?: number;
  maxPrice?: number;
};

const PUBLIC_SEARCH_FIELDS = [
  'id',
  'slug',
  'title',
  'description',
  'manufacturer',
  'manufacturerPartNumber',
  'genuineOemPartNumber',
  'oeNumbers',
  'oemNumbers',
  'interchangeNumbers',
  'supersededNumbers',
  'partType',
  'partSource',
  'qualityTier',
  'brand',
  'brandDisplay',
  'category',
  'categoryGroup',
  'makes',
  'models',
  'years',
  'side',
  'positions',
  'conditions',
  'minPrice',
  'maxPrice',
  'currencies',
  'offerCount',
  'inStock',
  'hasImage',
  'freeShipping',
  'fitments',
  'fitmentStatus',
  'fitmentConfidence',
  'listingQuality',
  'popularity',
  'imageUrls',
  'createdAt',
  'matchedVia',
  'matchedNumber',
  'position',
  'vehicleSystem',
  'material',
  'itemSpecifics',
  'oemCrossReferences',
  'compatibleVehicles',
  'compatibilityTable',
] as const;

const PUBLIC_SPECIFIC_KEYS = new Set([
  'partType',
  'placementOnVehicle',
  'position',
  'material',
  'color',
  'features',
  'countryOfOrigin',
  'condition',
  'brandType',
  'surfaceFinish',
  'isPerformancePart',
  'isCustomBundle',
  'isModifiedItem',
  'isUniversalFitment',
  'OE_numbers',
  'supersedes',
  'interchangeNumbers',
  'vehicleSystem',
  'categoryType',
  'enrichedTitle',
  'inferredProductType',
  'inferredSystemCategory',
  'fitmentHints',
  'compatibilityNote',
  'detailBullets',
  'searchKeywords',
  'productType',
  'systemCategory',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PHONE_LIKE_RE = /(?<![A-Z0-9])\+?\d[\d\s().-]{7,}\d(?![A-Z0-9])/g;

/**
 * Text immediately before a digit run that marks it as a part number rather
 * than a phone number: "Part Number 2115410001", "OE: 211 541 00 01",
 * "MPN 34106891080". Catalogue copy is generated in exactly this shape, so
 * without this guard every all-digit Mercedes/BMW/Porsche number was being
 * erased from descriptions and detail bullets as if it were a phone number.
 */
const PART_NUMBER_LABEL_RE =
  /\b(?:part\s*(?:number|no\.?|#)|p\/n|mpn|oem?|oe\s*(?:number|no\.?)|sku|ref(?:erence)?)\s*[:#.]?\s*$/i;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function protectedDigitKeys(
  numbers: readonly (string | null | undefined)[] = [],
): string[] {
  return numbers
    .map((number) => digitsOnly(String(number ?? '')))
    .filter((key) => key.length >= 6);
}

function isProtectedPartNumber(
  text: string,
  match: string,
  offset: number,
  protectedKeys: string[],
): boolean {
  const before = text.slice(Math.max(0, offset - 24), offset);
  if (PART_NUMBER_LABEL_RE.test(before)) return true;
  // "2133331300/64": a slash-suffixed variant code is part-number syntax.
  if (/^\/[A-Z0-9]/i.test(text.slice(offset + match.length))) return true;
  const key = digitsOnly(match);
  return protectedKeys.some(
    (protectedKey) => protectedKey === key || protectedKey.includes(key),
  );
}

/**
 * Remove contact details and known supplier identifiers from public copy.
 *
 * `protectedNumbers` are the listing's own part numbers (MPN, genuine OE
 * number, OE numbers). Digit runs equal to one of them are never treated as
 * phone numbers.
 */
export function sanitizeBuyerText(
  value: unknown,
  offers: IndexedOfferLike[] = [],
  productBrand?: string | null,
  redactPhone = true,
  protectedNumbers: readonly (string | null | undefined)[] = [],
): string | null {
  if (typeof value !== 'string') return null;
  let text = value
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '');
  if (redactPhone) {
    const protectedKeys = protectedDigitKeys(protectedNumbers);
    const source = text;
    text = source.replace(PHONE_LIKE_RE, (match: string, offset: number) =>
      isProtectedPartNumber(source, match, offset, protectedKeys) ? match : '',
    );
  }
  const normalizedBrand = String(productBrand || '')
    .trim()
    .toLowerCase();
  const supplierTerms = new Set<string>();
  for (const offer of offers) {
    const name = String(offer.sellerName || offer.seller?.name || '').trim();
    if (name && name.toLowerCase() !== normalizedBrand) supplierTerms.add(name);
    const sourceTag = String(offer.sourceTag || '').trim();
    if (sourceTag) supplierTerms.add(sourceTag);
  }
  for (const term of [...supplierTerms].sort((a, b) => b.length - a.length)) {
    text = text.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
        'giu',
      ),
      'PartsBazar360',
    );
  }
  return (
    text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .trim() || null
  );
}

export function sanitizeBuyerSpecifics(
  value: unknown,
  offers: IndexedOfferLike[] = [],
  brand?: string | null,
  protectedNumbers: readonly (string | null | undefined)[] = [],
) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!PUBLIC_SPECIFIC_KEYS.has(key)) continue;
    if (typeof entry === 'string') {
      result[key] = sanitizeBuyerText(
        entry,
        offers,
        brand,
        !/number|oe_numbers|supersedes|interchange/i.test(key),
        protectedNumbers,
      );
    } else if (Array.isArray(entry)) {
      result[key] = entry
        .map((item) =>
          typeof item === 'string'
            ? sanitizeBuyerText(item, offers, brand, false)
            : item,
        )
        .filter((item) => item != null);
    } else if (typeof entry === 'boolean' || typeof entry === 'number') {
      result[key] = entry;
    }
  }
  return result;
}

/** The listing's own part numbers, which public-copy redaction must keep. */
export function listingPartNumbers(item: unknown): string[] {
  if (!item || typeof item !== 'object') return [];
  const part = item as Record<string, unknown>;
  const oe = Array.isArray(part.oeNumbers) ? part.oeNumbers : [];
  return [part.manufacturerPartNumber, part.genuineOemPartNumber, ...oe]
    .filter((value): value is string => typeof value === 'string')
    .filter(Boolean);
}

export function isBuyerVisibleIndexedOffer(
  offer: IndexedOfferLike | null | undefined,
): boolean {
  if (!offer) return false;
  if (offer.sellerId && HIDDEN_SELLER_IDS.has(offer.sellerId)) return false;
  const name = offer.sellerName || offer.seller?.name || '';
  if (HIDDEN_SELLER_NAME_RE.test(name)) return false;
  // When status is present (PDP-shaped payloads), enforce ACTIVE.
  if (offer.status && offer.status !== 'ACTIVE') return false;
  if (
    offer.seller?.onboardingStatus &&
    offer.seller.onboardingStatus !== 'ACTIVE'
  ) {
    return false;
  }
  // Never surface a price-less offer — a tile/PDP without a price is worse
  // than no tile at all, and stale OS docs occasionally lack the price field.
  if (
    offer.price === null ||
    offer.price === undefined ||
    Number(offer.price) <= 0
  ) {
    return false;
  }
  return Boolean(offer.sellerId || name);
}

export function sanitizeSearchItem<T extends SearchItemLike>(
  item: T,
  constraints: OfferFilterConstraints = {},
): T | null {
  if (!item) return null;
  const selectedTags = new Set(
    (constraints.sourceTags || []).map((tag) => tag.toUpperCase()),
  );
  const filtered = (item.offers || []).filter(isBuyerVisibleIndexedOffer);
  const offers = applySuperiorPriority(filtered)
    .filter((offer) => {
      const price = Number(offer.price);
      if (selectedTags.size > 0) {
        const tag = String(offer.sourceTag || '').toUpperCase();
        if (!selectedTags.has(tag)) return false;
      }
      if (constraints.minPrice != null && price < constraints.minPrice) {
        return false;
      }
      if (constraints.maxPrice != null && price > constraints.maxPrice) {
        return false;
      }
      return true;
    })
    .slice()
    .sort(
      (a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity),
    );
  if (offers.length === 0) return null;
  const minPrice = Math.min(...offers.map((o) => Number(o.price) || Infinity));
  const publicOffers = offers.map((offer) => ({
    id: offer.id,
    price: offer.price,
    currency: offer.currency,
    condition: offer.condition,
    partSource: offer.partSource,
    partType: offer.partType,
    qualityTier: offer.qualityTier,
    moq: offer.moq,
    leadTimeDays: offer.leadTimeDays,
    inStock: offer.inStock !== false,
    freeShipping: offer.freeShipping === true,
  }));
  const rawImageUrls = (item.imageUrls as string[] | undefined) || [];
  const seenImg = new Set<string>();
  const imageUrls: string[] = [];
  for (const url of rawImageUrls) {
    if (!url || /\.svg(?:\?.*)?$/i.test(url)) continue;
    const norm = url
      .replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1')
      .replace(/\/\$_\d+\.(jpg|jpeg|png|webp)$/i, '/$_57.$1')
      .replace(/\?.*$/, '')
      .toLowerCase();
    if (!seenImg.has(norm)) {
      seenImg.add(norm);
      imageUrls.push(url);
    }
  }
  const publicItem: Record<string, unknown> = {};
  for (const field of PUBLIC_SEARCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item, field)) {
      publicItem[field] = item[field];
    }
  }
  const ownPartNumbers = listingPartNumbers(item);
  publicItem.title = sanitizeBuyerText(item.title, offers, item.brand, false);
  publicItem.description = sanitizeBuyerText(
    item.description,
    offers,
    item.brand,
    true,
    ownPartNumbers,
  );
  publicItem.itemSpecifics = sanitizeBuyerSpecifics(
    item.itemSpecifics,
    offers,
    item.brand,
    ownPartNumbers,
  );
  publicItem.fitmentFlags = Array.isArray(item.fitmentFlags)
    ? item.fitmentFlags.filter((flag) =>
        String(flag).toUpperCase().includes('UNIVERSAL'),
      )
    : [];
  if (Array.isArray(item.fitments)) {
    publicItem.fitments = item.fitments.map((fitment: any) =>
      typeof fitment === 'string'
        ? fitment
        : {
            vehicleConfigId: fitment.vehicleConfigId,
            evidenceLevel: fitment.evidenceLevel,
            confidence: fitment.confidence,
            verified: fitment.verified === true,
          },
    );
  }
  publicItem.fitmentStatus =
    item.fitmentStatus === 'CONFIRMED' ? 'LIKELY' : item.fitmentStatus;
  if (item.fitmentStatus === 'CONFIRMED') {
    publicItem.fitmentConfidence = Math.min(
      Number(item.fitmentConfidence) || 0,
      0.65,
    );
  }
  if (Array.isArray(item.compatibleVehicles)) {
    publicItem.compatibleVehicles = item.compatibleVehicles.map(
      (vehicle: any) => ({
        label: sanitizeBuyerText(vehicle.label, offers, item.brand, false),
        make: vehicle.make,
        model: vehicle.model,
        startYear: vehicle.startYear,
        endYear: vehicle.endYear,
        verified: false,
      }),
    );
  }
  if (Array.isArray(item.compatibilityTable)) {
    publicItem.compatibilityTable = item.compatibilityTable.map((row: any) => ({
      year: row.year,
      make: row.make,
      model: row.model,
      trim: row.trim,
      engine: row.engine,
    }));
  }
  if (Array.isArray(item.oemCrossReferences)) {
    publicItem.oemCrossReferences = item.oemCrossReferences.map((row: any) => ({
      number: row.number,
      normalizedNumber: row.normalizedNumber,
      make: row.make,
      verificationStatus: row.verificationStatus,
    }));
  }
  return {
    ...publicItem,
    brand: canonicalizeCatalogBrand(item.brand),
    brandDisplay: canonicalizeCatalogBrand(item.brand),
    makes: [
      ...new Set(
        (item.makes || [])
          .flatMap(canonicalizeVehicleMakes)
          .filter((make): make is string => Boolean(make)),
      ),
    ],
    offers: publicOffers,
    sourceTags: [],
    minPrice: Number.isFinite(minPrice) ? minPrice : (item.minPrice ?? null),
    maxPrice: Math.max(
      ...publicOffers.map((offer) => Number(offer.price) || 0),
    ),
    offerCount: publicOffers.length,
    conditions: [
      ...new Set(publicOffers.map((offer) => offer.condition).filter(Boolean)),
    ],
    currencies: [
      ...new Set(publicOffers.map((offer) => offer.currency).filter(Boolean)),
    ],
    imageUrls,
  } as unknown as T;
}

export function sanitizeSearchItems<T extends SearchItemLike>(
  items: T[] = [],
  constraints: OfferFilterConstraints = {},
): T[] {
  return (items || [])
    .map((item) => sanitizeSearchItem(item, constraints))
    .filter((item): item is T => Boolean(item));
}
