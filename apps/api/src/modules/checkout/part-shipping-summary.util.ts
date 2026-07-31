/**
 * Builds the buyer-facing shipping summary for a single part.
 *
 * The PDP must render immediately, so this always returns usable numbers — an
 * unknown weight falls back to the part-class median rather than leaving the UI
 * to show a spinner where a shipping figure belongs. `state` tells the client
 * how much to trust the values and whether it is worth polling for a better
 * answer once background enrichment finishes.
 */

import {
  estimatedVolumetricFactorFromEnv,
  isExactWeightSource,
  maxParcelKgFromEnv,
  parseDimensionsJson,
  resolveItemWeight,
  volumetricDivisorFromEnv,
  type DimensionsCm,
  type WeightBasis,
  type WeightSource,
} from './billable-weight.util';
import { resolvePartClassKey } from './part-class-weights';

export type ShippingSummaryState = 'exact' | 'estimated' | 'pending';

/** Enrichment states that mean a better answer is actively being computed. */
const IN_FLIGHT_STATUSES = new Set(['QUEUED', 'RUNNING']);

export interface PartShippingSummary {
  state: ShippingSummaryState;
  /** Actual (mass) weight in kg. */
  weightKg: number;
  /** Weight the carrier will bill: max(actual, volumetric). */
  billableWeightKg: number;
  volumetricWeightKg: number | null;
  weightBasis: WeightBasis;
  source: WeightSource;
  confidence: number | null;
  partClassKey: string;
  dimensionsCm: DimensionsCm | null;
  /** True when dimensions came from the class profile, not the part itself. */
  dimensionsEstimated: boolean;
  /** True when the parcel exceeds courier limits and needs a manual quote. */
  requiresFreightQuote: boolean;
  /** True when the stored weight is outside the class envelope. */
  weightOutlier: boolean;
  /** True when a unit error was auto-corrected (g → kg). */
  weightAutoConverted: boolean;
}

export interface ShippingSummaryPartInput {
  title?: string | null;
  category?: string | null;
  weight?: number | null;
  weightSource?: string | null;
  weightConfidence?: number | null;
  partClassKey?: string | null;
  dimensions?: unknown;
  enrichmentStatus?: string | null;
}

export function buildPartShippingSummary(
  part: ShippingSummaryPartInput,
  options: { maxParcelKg?: number } = {},
): PartShippingSummary {
  const partClassKey =
    part.partClassKey ??
    resolvePartClassKey({ title: part.title, category: part.category });

  const dimensionsCm = parseDimensionsJson(part.dimensions);

  const resolved = resolveItemWeight({
    weightKg: part.weight ?? null,
    dimensionsCm,
    weightSource: part.weightSource ?? null,
    partClassKey,
    divisor: volumetricDivisorFromEnv(),
    estimatedVolumetricFactor: estimatedVolumetricFactorFromEnv(),
  });

  const weightIsExact = isExactWeightSource(resolved.source);
  // Only "exact" when both inputs to the billable calculation are real: an exact
  // mass with guessed dimensions still produces an estimated volumetric weight.
  const fullyKnown = weightIsExact && !resolved.dimensionsEstimated;

  let state: ShippingSummaryState;
  if (fullyKnown) {
    state = 'exact';
  } else if (IN_FLIGHT_STATUSES.has(part.enrichmentStatus || '')) {
    state = 'pending';
  } else {
    state = 'estimated';
  }

  const maxParcelKg = options.maxParcelKg ?? maxParcelKgFromEnv();

  return {
    state,
    weightKg: resolved.actualKg,
    billableWeightKg: resolved.billableKg,
    volumetricWeightKg: resolved.volumetricKg,
    weightBasis: resolved.basis,
    source: resolved.source,
    confidence: weightIsExact ? (part.weightConfidence ?? null) : null,
    partClassKey: resolved.partClassKey,
    dimensionsCm,
    dimensionsEstimated: resolved.dimensionsEstimated,
    requiresFreightQuote: resolved.billableKg > maxParcelKg,
    weightOutlier: resolved.outlier,
    weightAutoConverted: resolved.unitAutoConverted,
  };
}
