/**
 * Builds a v2 search document from a canonical part.
 *
 * The defect this exists to fix: today `normalizedPartNumbers` is derived *only*
 * from `CatalogPartNumber` rows, so it is populated for 60,711 of 125,859
 * documents (48 %). The 65,148 salvage documents have no such row and therefore
 * no normalized number at all, which is why "86401-12020" returns unrelated
 * parts while "8640112020" works. See docs/SEARCH_PHASE1_AUDIT.md §4 RC-1.
 *
 * Here every number the part carries — manufacturer part number, OE numbers,
 * and catalogue rows — is normalized into `searchNumbers`, so separator-
 * insensitive matching works for 100 % of documents. Original values are kept
 * verbatim in `displayNumbers` for display and audit (brief §4).
 */

import { normalizePartNumber } from '../query/part-number.util';
import { applySuperiorPriority } from '../buyer-visible-offers.util';
import {
  canonicalizeCatalogBrand,
  canonicalizeVehicleMakes,
} from '../../catalog-import/catalog-identity.util';
import {
  classifyPartType,
  classifyPositions,
  classifySide,
} from './part-type-classifier';

/** Offers that must never reach a buyer. Mirrors buyer-visible-offers.util. */
const HIDDEN_SELLER_IDS = new Set(['seed-febest-inventory-supplier']);
const HIDDEN_SELLER_NAME = /febest\s+inventory\s+supplier/i;

export interface BuiltSearchDocument {
  id: string;
  [key: string]: unknown;
}

/** Keep only offers a buyer is allowed to see. */
export function buyerVisibleOffers(part: any): any[] {
  const raw = Array.isArray(part?.offers) ? part.offers : [];
  const visible = raw.filter((offer: any) => {
    if (!offer) return false;
    if (HIDDEN_SELLER_IDS.has(offer.sellerId)) return false;
    if (offer.status && offer.status !== 'ACTIVE') return false;
    const sellerStatus = offer.seller?.onboardingStatus ?? offer.sellerOnboardingStatus;
    if (sellerStatus && sellerStatus !== 'ACTIVE') return false;
    const sellerName = offer.sellerName ?? offer.seller?.name ?? '';
    if (HIDDEN_SELLER_NAME.test(sellerName)) return false;
    if (offer.price != null && Number(offer.price) <= 0) return false;
    return true;
  });
  // Superior outranks Blackline/Salvage on the same part, so the suppressed
  // offers must not reach minPrice, sourceTags or any other rolled-up facet.
  return applySuperiorPriority(visible);
}

function uniqueStrings(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) seen.add(text);
  }
  return [...seen];
}

function normalizedSet(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizePartNumber(value);
    // 3 characters is the shortest thing that can meaningfully identify a part;
    // shorter fragments match far too much.
    if (normalized.length >= 3) seen.add(normalized);
  }
  return [...seen];
}

/** Numbers grouped by role, so ranking can honour the brief's §5 ordering. */
function collectNumbers(part: any) {
  const catalogue = Array.isArray(part?.partNumbers) ? part.partNumbers : [];
  const byType = (predicate: (type: string) => boolean) =>
    catalogue
      .filter((row: any) => predicate(String(row?.numberType ?? '')))
      .map((row: any) => row?.normalizedNumber ?? row?.displayNumber);

  const oe = Array.isArray(part?.oeNumbers) ? part.oeNumbers : [];

  const oemNumbers = normalizedSet([
    ...oe,
    part?.manufacturerPartNumber,
    ...byType((type) => type === 'BRAND_MPN' || type === 'OEM'),
  ]);
  const interchangeNumbers = normalizedSet(
    byType((type) => type === 'OEM_CROSS_REFERENCE' || type === 'INTERCHANGE'),
  );
  const supersededNumbers = normalizedSet(byType((type) => type === 'SUPERSEDED'));
  const skuNumbers = normalizedSet([
    ...(Array.isArray(part?.offers) ? part.offers.map((o: any) => o?.sellerSku) : []),
    ...byType((type) => type === 'SELLER_SKU' || type === 'SKU'),
  ]);

  // The catch-all. This is the field that makes every separator form of every
  // number on the part equivalent, for every document.
  const searchNumbers = normalizedSet([
    ...oemNumbers,
    ...interchangeNumbers,
    ...supersededNumbers,
    ...skuNumbers,
  ]);

  // Original, un-normalized forms — display and audit only, never searched.
  const displayNumbers = uniqueStrings([
    part?.manufacturerPartNumber,
    ...oe,
    ...catalogue.map((row: any) => row?.displayNumber),
  ]);

  return {
    oemNumbers,
    interchangeNumbers,
    supersededNumbers,
    skuNumbers,
    searchNumbers,
    displayNumbers,
  };
}

/**
 * 0–1 completeness score used only as a tie-break (capped well below any
 * relevance tier — see relevance.builder.ts).
 */
export function listingQuality(part: any, offers: any[], hasImage: boolean): number {
  let score = 0;
  if (hasImage) score += 0.3;
  if (part?.title && String(part.title).length >= 25) score += 0.15;
  if (part?.description) score += 0.1;
  if (part?.manufacturerPartNumber) score += 0.15;
  if (part?.brand) score += 0.1;
  if (Array.isArray(part?.fitments) && part.fitments.length) score += 0.1;
  if (offers.length > 1) score += 0.1;
  return Math.round(Math.min(1, score) * 100) / 100;
}

/**
 * Build the indexable document, or `null` when the part has no buyer-visible
 * offer (in which case the caller should delete it from the index).
 */
export function buildSearchDocument(part: any): BuiltSearchDocument | null {
  const offers = buyerVisibleOffers(part);
  if (offers.length === 0) return null;

  const numbers = collectNumbers(part);
  const title = part?.title ?? null;

  const prices = offers
    .map((offer: any) => Number(offer?.price))
    .filter((price: number) => Number.isFinite(price) && price > 0);

  const rawImageUrls = Array.isArray(part?.imageUrls) ? part.imageUrls.filter(Boolean) : [];
  const seenImg = new Set<string>();
  const imageUrls: string[] = [];
  for (const url of rawImageUrls) {
    if (/\.svg(?:\?.*)?$/i.test(url)) continue;
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
  const hasImage = imageUrls.length > 0;

  const fitments = Array.isArray(part?.fitments) ? part.fitments : [];
  // Only A/B evidence at ≥0.8 confidence may be presented as a confirmed fit.
  // Title-inferred matches stay advisory and never enter guaranteed-fit search.
  const verifiedFitments = fitments
    .filter(
      (fitment: any) =>
        ['A', 'B'].includes(fitment?.evidenceLevel) && Number(fitment?.confidence) >= 0.8,
    )
    .map((fitment: any) => fitment?.vehicleConfigId)
    .filter(Boolean);

  const compatibility = Array.isArray(part?.compatibility) ? part.compatibility : [];
  const makes = uniqueStrings([
    ...compatibility.map((row: any) => row?.make),
    ...(Array.isArray(part?.makes) ? part.makes : []),
  ].flatMap(canonicalizeVehicleMakes));
  const models = uniqueStrings(compatibility.map((row: any) => row?.model));

  const years: number[] = [
    ...new Set<number>(
      compatibility
        .flatMap((row: any): number[] => {
          const from = Number(row?.yearFrom ?? row?.year);
          const to = Number(row?.yearTo ?? row?.year);
          if (!Number.isFinite(from)) return [];
          const end = Number.isFinite(to) ? to : from;
          // Guard against absurd ranges in seller data.
          if (end < from || end - from > 40) return [from];
          return Array.from({ length: end - from + 1 }, (_, i) => from + i);
        })
        .filter((year: number) => year >= 1950 && year <= 2049),
    ),
  ].sort((a, b) => a - b);

  return {
    id: part.id,

    title,
    description: part?.description ?? null,

    ...numbers,
    manufacturerPartNumber: part?.manufacturerPartNumber
      ? normalizePartNumber(part.manufacturerPartNumber)
      : null,

    // Derived, because the stored column holds provenance rather than a part
    // type. `null` when the title does not confidently name one.
    partType: classifyPartType(title),
    partSource: part?.partSource ?? null,
    qualityTier: part?.qualityTier ?? null,
    brand: canonicalizeCatalogBrand(part?.brand),
    brandDisplay: canonicalizeCatalogBrand(part?.brand),
    category: part?.category ?? null,
    sourceTags: uniqueStrings(offers.map((offer: any) => offer?.sourceTag)),

    makes,
    models,
    years,
    side: classifySide(title),
    positions: classifyPositions(title),

    conditions: uniqueStrings(offers.map((offer: any) => offer?.condition)),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    currencies: uniqueStrings(offers.map((offer: any) => offer?.currency)),
    sellerIds: uniqueStrings(offers.map((offer: any) => offer?.sellerId)),
    sellerNames: uniqueStrings(
      offers.map((offer: any) => offer?.sellerName ?? offer?.seller?.name),
    ),
    offerCount: offers.length,
    inStock: offers.some((offer: any) => offer?.inStock !== false),
    hasImage,
    freeShipping: offers.some((offer: any) => offer?.freeShipping === true),

    fitments: verifiedFitments,
    verifiedFitments,
    fitmentStatus: part?.fitmentStatus ?? null,
    fitmentConfidence: part?.fitmentConfidence ?? null,

    listingQuality: listingQuality(part, offers, hasImage),
    popularity: Number(part?.popularity) || 0,

    imageUrls,
    listingUrl: part?.listingUrl ?? null,
    ebayItemId: part?.ebayItemId ?? null,

    createdAt: part?.createdAt ?? new Date().toISOString(),
    updatedAt: part?.updatedAt ?? null,
    indexedAt: new Date().toISOString(),

    offers: offers.map((offer: any) => ({
      id: offer.id,
      sellerId: offer.sellerId ?? null,
      sellerName: offer.sellerName ?? offer.seller?.name ?? null,
      price: Number.isFinite(Number(offer.price)) ? Number(offer.price) : null,
      currency: offer.currency ?? null,
      condition: offer.condition ?? null,
      partSource: offer.partSource ?? null,
      qualityTier: offer.qualityTier ?? null,
      sourceTag: offer.sourceTag ?? null,
      inStock: offer.inStock !== false,
      freeShipping: offer.freeShipping === true,
    })),
  };
}
