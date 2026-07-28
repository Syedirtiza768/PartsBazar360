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
  rawCached: boolean | null;
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

function fieldKey(name: string): string {
  return (
    ITEM_SPECIFIC_FIELD_TO_KEY[name] ||
    name.charAt(0).toLowerCase() + name.slice(1).replace(/\s+/g, '')
  );
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
        (Array.isArray(row.values) ? row.values[0] : null) ??
        (Array.isArray(row.Value) ? row.Value[0] : null);
      if (value == null || value === '') continue;
      map[fieldKey(name)] = Array.isArray(value) ? value[0] : value;
    }
    return Object.keys(map).length ? map : null;
  }

  const obj = asRecord(raw);
  if (!obj) return null;
  const map: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    map[fieldKey(k)] = Array.isArray(v) ? v[0] : v;
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
): string[] | null {
  const fromPayload = payload.oeNumbers;
  if (Array.isArray(fromPayload) && fromPayload.length) {
    return fromPayload.map(String).filter(Boolean);
  }
  const single = pickString(
    payload.oeNumber,
    payload.oemNumber,
    specifics?.oeNumber,
    specifics?.OE_numbers,
    specifics?.mpn,
  );
  return single ? [single] : null;
}

export function mapTradingEnrichmentPayload(
  payload: unknown,
): RealTrackEnrichmentMapped {
  const root = asRecord(payload) || {};
  // Some APIs nest under `data` / `enrichment` / `listing`.
  const body =
    asRecord(root.data) ||
    asRecord(root.enrichment) ||
    asRecord(root.listing) ||
    root;

  const itemSpecifics = normalizeItemSpecifics(
    body.itemSpecifics ?? body.ItemSpecifics ?? body.specifics,
  );

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
    oeNumbers: extractOeNumbers(itemSpecifics, body),
    description: pickString(body.description, body.descriptionHtml),
    weightKg: extractWeight(body),
    dimensionsCm: extractDimensions(body),
    imageUrls: extractImages(body),
    brand: pickString(body.brand, itemSpecifics?.brandType, itemSpecifics?.brand),
    rawCached:
      typeof body.cached === 'boolean'
        ? body.cached
        : typeof root.cached === 'boolean'
          ? root.cached
          : null,
  };
}
