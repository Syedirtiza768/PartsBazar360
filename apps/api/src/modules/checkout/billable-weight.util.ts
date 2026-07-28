/**
 * Billable (chargeable) weight resolution.
 *
 * Carriers bill max(actual, volumetric). The legacy quote path used actual
 * weight only, which systematically under-charged bulky-light parts — a bumper
 * cover is ~8kg actual but well over 50kg volumetric. Every quote now resolves a
 * billable weight and reports which basis and data source produced it.
 */

import {
  clampWeightToClass,
  getPartClassProfile,
  type PartClassProfile,
} from './part-class-weights';

export interface DimensionsCm {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

/**
 * cm³ per kg, per the active EMX/Aramex contract. IATA air freight uses 5000;
 * this contract bills at 6000, which yields ~20% lower volumetric weight.
 * Override with SHIPPING_VOLUMETRIC_DIVISOR if the contract is renegotiated.
 */
export const DEFAULT_VOLUMETRIC_DIVISOR = 6000;

/**
 * Volumetric weight from guessed (class-default) dimensions is dampened, because
 * a misclassified part would otherwise be dramatically over-quoted. Real
 * seller-supplied dimensions are never dampened.
 */
export const DEFAULT_ESTIMATED_VOLUMETRIC_FACTOR = 0.8;

export type WeightSource =
  | 'SPREADSHEET'
  | 'SELLER'
  | 'MEASURED'
  | 'SIBLING_MPN'
  | 'AI'
  | 'CLASS_DEFAULT';

export type WeightBasis = 'ACTUAL' | 'VOLUMETRIC';

/** Sources that represent a real measurement rather than an estimate. */
const EXACT_SOURCES: ReadonlySet<WeightSource> = new Set<WeightSource>([
  'SPREADSHEET',
  'SELLER',
  'MEASURED',
]);

export function isExactWeightSource(
  source: WeightSource | string | null | undefined,
): boolean {
  return EXACT_SOURCES.has(source as WeightSource);
}

export function volumetricWeightKg(
  dims: DimensionsCm | null | undefined,
  divisor: number = DEFAULT_VOLUMETRIC_DIVISOR,
): number | null {
  if (!dims) return null;
  const { lengthCm, widthCm, heightCm } = dims;
  if (
    !Number.isFinite(lengthCm) ||
    !Number.isFinite(widthCm) ||
    !Number.isFinite(heightCm)
  ) {
    return null;
  }
  if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) return null;
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return round((lengthCm * widthCm * heightCm) / divisor, 3);
}

export function parseDimensionsJson(
  value: unknown,
): DimensionsCm | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const lengthCm = toPositiveNumber(raw.lengthCm ?? raw.length ?? raw.l);
  const widthCm = toPositiveNumber(raw.widthCm ?? raw.width ?? raw.w);
  const heightCm = toPositiveNumber(raw.heightCm ?? raw.height ?? raw.h);
  if (lengthCm === null || widthCm === null || heightCm === null) return null;
  return { lengthCm, widthCm, heightCm };
}

export interface ResolveItemWeightInput {
  /** Actual weight in kg, when known from any source. */
  weightKg?: number | null;
  /** Real packed dimensions, when known. */
  dimensionsCm?: DimensionsCm | null;
  /** Where `weightKg` came from; drives estimate handling and margins. */
  weightSource?: WeightSource | string | null;
  /** Resolved part-class key used for defaults and clamping. */
  partClassKey?: string | null;
  divisor?: number;
  estimatedVolumetricFactor?: number;
}

export interface ResolvedItemWeight {
  actualKg: number;
  volumetricKg: number | null;
  billableKg: number;
  basis: WeightBasis;
  source: WeightSource;
  /** True when dimensions were taken from the class profile, not the part. */
  dimensionsEstimated: boolean;
  /** True when the supplied weight fell outside the class envelope. */
  clamped: boolean;
  partClassKey: string;
  profile: PartClassProfile;
}

/**
 * Resolves one line item's billable weight, filling gaps from the part class.
 */
export function resolveItemWeight(
  input: ResolveItemWeightInput,
): ResolvedItemWeight {
  const profile = getPartClassProfile(input.partClassKey);
  const divisor = input.divisor ?? DEFAULT_VOLUMETRIC_DIVISOR;
  const estimatedFactor =
    input.estimatedVolumetricFactor ?? DEFAULT_ESTIMATED_VOLUMETRIC_FACTOR;

  const suppliedWeight =
    typeof input.weightKg === 'number' && input.weightKg > 0
      ? input.weightKg
      : null;

  let source: WeightSource;
  let actualKg: number;
  let clamped = false;

  if (suppliedWeight !== null) {
    source = (input.weightSource as WeightSource) || 'AI';
    if (isExactWeightSource(source)) {
      // Trust a real measurement even when it sits outside the class envelope.
      actualKg = suppliedWeight;
    } else {
      const result = clampWeightToClass(suppliedWeight, profile);
      actualKg = result.kg;
      clamped = result.clamped;
    }
  } else {
    source = 'CLASS_DEFAULT';
    actualKg = profile.medianWeightKg;
  }

  const realDims = input.dimensionsCm ?? null;
  const dimensionsEstimated = !realDims;
  const dims: DimensionsCm = realDims ?? {
    lengthCm: profile.typicalDimsCm.l,
    widthCm: profile.typicalDimsCm.w,
    heightCm: profile.typicalDimsCm.h,
  };

  const rawVolumetric = volumetricWeightKg(dims, divisor);
  const volumetricKg =
    rawVolumetric === null
      ? null
      : dimensionsEstimated
        ? round(rawVolumetric * estimatedFactor, 3)
        : rawVolumetric;

  const useVolumetric = volumetricKg !== null && volumetricKg > actualKg;

  return {
    actualKg: round(actualKg, 3),
    volumetricKg,
    billableKg: round(useVolumetric ? (volumetricKg as number) : actualKg, 3),
    basis: useVolumetric ? 'VOLUMETRIC' : 'ACTUAL',
    source,
    dimensionsEstimated,
    clamped,
    partClassKey: profile.key,
    profile,
  };
}

export interface DeriveBillableWeightInput {
  actualKg?: number | null;
  dimensionsCm?: DimensionsCm | null;
  divisor?: number;
}

export interface DerivedBillableWeight {
  actualKg: number | null;
  volumetricKg: number | null;
  billableKg: number;
  basis: WeightBasis;
}

/**
 * Precomputes stored billable weight for a part from known values only. Returns
 * null when neither a weight nor usable dimensions are available — callers
 * persist null rather than a guess, leaving the class default to the quote path.
 */
export function deriveBillableWeight(
  input: DeriveBillableWeightInput,
): DerivedBillableWeight | null {
  const actualKg =
    typeof input.actualKg === 'number' && input.actualKg > 0
      ? round(input.actualKg, 3)
      : null;
  const volumetricKg = volumetricWeightKg(input.dimensionsCm, input.divisor);

  if (actualKg === null && volumetricKg === null) return null;

  const useVolumetric =
    volumetricKg !== null && (actualKg === null || volumetricKg > actualKg);

  return {
    actualKg,
    volumetricKg,
    billableKg: useVolumetric ? (volumetricKg as number) : (actualKg as number),
    basis: useVolumetric ? 'VOLUMETRIC' : 'ACTUAL',
  };
}

function toPositiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Reads the volumetric divisor from env, falling back to the IATA default. */
export function volumetricDivisorFromEnv(): number {
  const raw = Number.parseFloat(process.env.SHIPPING_VOLUMETRIC_DIVISOR || '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VOLUMETRIC_DIVISOR;
}

/** Reads the dampening factor applied to class-estimated volumetric weights. */
export function estimatedVolumetricFactorFromEnv(): number {
  const raw = Number.parseFloat(
    process.env.SHIPPING_ESTIMATED_VOLUMETRIC_FACTOR || '',
  );
  return Number.isFinite(raw) && raw > 0 && raw <= 1
    ? raw
    : DEFAULT_ESTIMATED_VOLUMETRIC_FACTOR;
}

/**
 * Practical per-parcel ceiling for the courier products in the EMX sheet.
 *
 * The sheet only defines bands up to 2kg and rate lookup extrapolates linearly
 * past that, which produces meaningless numbers at freight weights (a 184kg
 * engine came out near AED 28,000). Anything above this needs a real freight
 * quote instead.
 */
export const DEFAULT_MAX_PARCEL_KG = 30;

export function maxParcelKgFromEnv(): number {
  const raw = Number.parseFloat(process.env.SHIPPING_MAX_PARCEL_KG || '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_PARCEL_KG;
}

/** Safety margin applied to estimated (non-measured) billable weights. */
export function estimateMarginPctFromEnv(): number {
  const raw = Number.parseFloat(
    process.env.SHIPPING_ESTIMATE_MARGIN_PCT || '',
  );
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 15;
}
