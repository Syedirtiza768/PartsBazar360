export type BridgePriceSkipReason = 'below_minimum' | 'invalid_cost';

export interface BridgePriceDecision {
  sellingPrice: number | null;
  skipReason: BridgePriceSkipReason | null;
}

/**
 * RealTrack bridge pricing rule. All boundaries are inclusive.
 * The caller is responsible for checking the source currency before applying
 * this currency-agnostic numeric rule.
 */
export function calculateRealtrackPrice(cost: number): BridgePriceDecision {
  if (!Number.isFinite(cost) || cost < 0) {
    return { sellingPrice: null, skipReason: 'invalid_cost' };
  }
  if (cost < 5) {
    return { sellingPrice: null, skipReason: 'below_minimum' };
  }
  if (cost <= 15) return { sellingPrice: 38, skipReason: null };
  if (cost <= 21) return { sellingPrice: 45.99, skipReason: null };
  if (cost <= 25) return { sellingPrice: 49.99, skipReason: null };

  return {
    sellingPrice: Math.round((cost * 2 + Number.EPSILON) * 100) / 100,
    skipReason: null,
  };
}
