/**
 * Maps RealTrack `trading-enrichment` payloads onto CanonicalPart fields.
 *
 * The live contract is still landing on RealTrack; this mapper accepts several
 * plausible shapes (flat map, Name/Value arrays, eBay packageWeightAndSize)
 * so we do not need another deploy when the response settles.
 */

import { ITEM_SPECIFIC_FIELD_TO_KEY } from './item-specifics-generator';
import type { DimensionsCm } from '../checkout/billable-weight.util';

export interface RealTrackEnrichmentMapped {
  itemSpecifics: Record<string, unknown> | null;
  position: string | null;
  material: string | null;
  vehicleSystem: string | null;
  manufacturerPartNumber: string | null;
  oeNumbers: string[] | null;
  description: string | null;
  weightKg: number | null;
  dimensionsCm: DimensionsCm | null;
  imageUrls: string[] | null;
  brand: string | null;
  compatibility: unknown | null;
  rawCached: boolean | null;
  budgetRemaining: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Undo one layer of HTML entity encoding (some Trading payloads are escaped). */
export function decodeHtmlEntities(input: string): string {
  if (!/&(?:lt|gt|quot|#39|amp);/i.test(input)) return input;
  return input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
}

function fieldKey(name: string): string {
  return (
    ITEM_SPECIFIC_FIELD_TO_KEY[name] ||
    name.charAt(0).toLowerCase() + name.slice(1).replace(/\s+/g, '')
  );
}

function normalizeSpecificValue(key: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const strings = value.map(String).filter((s) => s.trim());
  if (!strings.length) return null;
  // Multi-value fields (Features, OE lists) keep a readable join; singles take [0].
  if (
    strings.length > 1 &&
    /feature|oe|oem|number|compatible/i.test(key)
  ) {
    return strings.join(', ');
  }
  return strings[0];
}

/** Normalize item specifics from map or [{name|field, value|values}] arrays. */
export function normalizeItemSpecifics(
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw) return null;

  if (Array.isArray(raw)) {
    const map: Record<string, unknown> = {};
    for (const entry of raw) {
      const row = asRecord(entry);
      if (!row) continue;
      const name = pickString(row.name, row.Name, row.field, row.Field);
      if (!name) continue;
      const value =
        row.value ??
        row.Value ??
        row.normalizedValue ??
        row.values ??
        null;
      if (value == null || value === '') continue;
      const normalized = normalizeSpecificValue(name, value);
      if (normalized == null || normalized === '') continue;
      map[fieldKey(name)] = normalized;
    }
    return Object.keys(map).length ? map : null;
  }

  const obj = asRecord(raw);
  if (!obj) return null;
  const map: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    const normalized = normalizeSpecificValue(k, v);
    if (normalized == null || normalized === '') continue;
    map[fieldKey(k)] = normalized;
  }
  return Object.keys(map).length ? map : null;
}

function toKg(value: unknown, unit?: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = String(unit || 'kg').toLowerCase();
  if (u.startsWith('lb') || u === 'pound' || u === 'pounds') return n * 0.45359237;
  if (u.startsWith('oz')) return n * 0.0283495231;
  if (u.startsWith('g') && !u.startsWith('kg')) return n / 1000;
  return n; // kg / kilogram / KILOGRAM
}

function toCm(value: unknown, unit?: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = String(unit || 'cm').toLowerCase();
  if (u.startsWith('in') || u === 'inch' || u === 'inches') return n * 2.54;
  if (u.startsWith('mm')) return n / 10;
  if (u.startsWith('m') && !u.startsWith('mm') && !u.startsWith('mi')) return n * 100;
  return n;
}

function extractWeight(payload: Record<string, unknown>): number | null {
  const direct = toKg(
    payload.weightKg ?? payload.weight,
    payload.weightUnit,
  );
  if (direct) return direct;

  const pkg = asRecord(payload.packageWeightAndSize) || asRecord(payload.shippingPackage);
  if (pkg) {
    const w = asRecord(pkg.weight) || pkg;
    return toKg(w.value ?? w.Weight ?? pkg.weightKg, w.unit ?? w.Unit ?? pkg.weightUnit);
  }

  const shipping = asRecord(payload.shipping);
  if (shipping) {
    return toKg(shipping.weightKg ?? shipping.weight, shipping.weightUnit);
  }
  return null;
}

function extractDimensions(
  payload: Record<string, unknown>,
): DimensionsCm | null {
  const dims =
    asRecord(payload.dimensionsCm) ||
    asRecord(payload.dimensions) ||
    asRecord(asRecord(payload.packageWeightAndSize)?.dimensions) ||
    asRecord(asRecord(payload.shippingPackage)?.dimensions);
  if (!dims) return null;

  const unit = dims.unit ?? dims.Unit ?? payload.dimensionUnit;
  const lengthCm = toCm(dims.lengthCm ?? dims.length ?? dims.Length, unit);
  const widthCm = toCm(dims.widthCm ?? dims.width ?? dims.Width, unit);
  const heightCm = toCm(dims.heightCm ?? dims.height ?? dims.Height, unit);
  if (!lengthCm || !widthCm || !heightCm) return null;
  return { lengthCm, widthCm, heightCm };
}

function extractImages(payload: Record<string, unknown>): string[] | null {
  const candidates = [
    payload.imageUrls,
    payload.pictureUrls,
    payload.pictures,
    payload.images,
  ];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const urls = c
      .map((x) => {
        if (typeof x === 'string') return x;
        const row = asRecord(x);
        return pickString(row?.url, row?.imageUrl, row?.src);
      })
      .filter((u): u is string => Boolean(u));
    if (urls.length) return [...new Set(urls)];
  }
  return null;
}

function extractOeNumbers(
  specifics: Record<string, unknown> | null,
  payload: Record<string, unknown>,
  rawSpecifics: unknown,
): string[] | null {
  const collected: string[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) if (x != null && String(x).trim()) collected.push(String(x).trim());
    } else if (typeof v === 'string' && v.trim()) {
      for (const part of v.split(/[,;|]/)) {
        if (part.trim()) collected.push(part.trim());
      }
    }
  };

  push(payload.oeNumbers);
  push(payload.oeNumber);
  push(payload.oemNumber);

  const rawObj = asRecord(rawSpecifics);
  if (rawObj) {
    for (const [k, v] of Object.entries(rawObj)) {
      if (/oe|oem|mpn|manufacturer part/i.test(k)) push(v);
    }
  }
  push(specifics?.oeNumber);
  push(specifics?.OE_numbers);
  push(specifics?.mpn);

  const unique = [...new Set(collected)];
  return unique.length ? unique : null;
}

export function mapTradingEnrichmentPayload(
  payload: unknown,
): RealTrackEnrichmentMapped {
  const root = asRecord(payload) || {};
  // Verified live shape nests under `data`; `cached` + `budget` sit on the root.
  const body =
    asRecord(root.data) ||
    asRecord(root.enrichment) ||
    asRecord(root.listing) ||
    root;

  const rawSpecifics = body.itemSpecifics ?? body.ItemSpecifics ?? body.specifics;
  const itemSpecifics = normalizeItemSpecifics(rawSpecifics);

  const descriptionRaw = pickString(body.description, body.descriptionHtml);
  const budget = asRecord(root.budget);

  return {
    itemSpecifics,
    position: pickString(
      body.position,
      itemSpecifics?.position,
      itemSpecifics?.placementOnVehicle,
    ),
    material: pickString(body.material, itemSpecifics?.material),
    vehicleSystem: pickString(body.vehicleSystem, itemSpecifics?.vehicleSystem),
    manufacturerPartNumber: pickString(
      body.manufacturerPartNumber,
      body.mpn,
      itemSpecifics?.mpn,
    ),
    oeNumbers: extractOeNumbers(itemSpecifics, body, rawSpecifics),
    description: descriptionRaw ? decodeHtmlEntities(descriptionRaw) : null,
    weightKg: extractWeight(body),
    dimensionsCm: extractDimensions(body),
    imageUrls: extractImages(body),
    brand: pickString(body.brand, itemSpecifics?.brandType, itemSpecifics?.brand),
    compatibility: body.compatibility ?? null,
    rawCached:
      typeof root.cached === 'boolean'
        ? root.cached
        : typeof body.cached === 'boolean'
          ? body.cached
          : null,
    budgetRemaining:
      typeof budget?.remaining === 'number' ? budget.remaining : null,
  };
}
