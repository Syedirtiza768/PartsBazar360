import { Injectable } from '@nestjs/common';
import { PAYMENT_TEST_PART_ID } from '@repo/catalog-contracts';
import { EMX_RATE_BANDS, EMX_RATE_SHEET } from './emx-rate-sheet';
import {
  estimateMarginPctFromEnv,
  estimatedVolumetricFactorFromEnv,
  isExactWeightSource,
  maxParcelKgFromEnv,
  resolveItemWeight,
  volumetricDivisorFromEnv,
  type DimensionsCm,
  type WeightBasis,
  type WeightSource,
} from './billable-weight.util';

/** UAE domestic flat rates by parcel weight (kg). */
const UAE_FLAT_TIERS = [
  { maxKg: 2, amount: 20, label: 'small' },
  { maxKg: 10, amount: 50, label: 'medium' },
  { maxKg: 25, amount: 75, label: 'large' },
] as const;

const UAE_COUNTRY_ALIASES = new Set([
  'uae',
  'u.a.e',
  'u.a.e.',
  'ae',
  'united arab emirates',
  'emirates',
]);

/**
 * The buyer-facing checkout country dropdown (SHIPPING_COUNTRIES) uses
 * shorter/common country names than the EMX rate sheet does. Without this
 * map those destinations look "unmatched" — silently falling back to the
 * generic average rate/lead time — even though the sheet has an exact row
 * for them under its own naming. Keyed and valued in normalized (lowercased,
 * whitespace-collapsed) form.
 *
 * This list is exhaustive for naming mismatches: every dropdown entry not
 * covered here and not resolved via `rowsByCountry` genuinely has no EMX row
 * at all (small/embargoed markets the sheet doesn't service), so no alias
 * would help — those require a manual shipping arrangement and must not be
 * assigned an averaged buyer charge.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  brunei: 'brunei darussalam',
  'cabo verde': 'cape verde',
  'congo (drc)': 'congo - d.rep',
  'congo (republic)': 'congo-rep',
  'czech republic': 'czech rep.',
  'north macedonia': 'macedonia',
  russia: 'russian federation',
  'south korea': 'korea rep.',
  'united states': 'united states of america',
};

export interface ShippingQuoteItem {
  quantity: number;
  /** Canonical part id, used for tightly scoped shipping exceptions. */
  canonicalPartId?: string | null;
  /** Actual unit weight in kg. */
  weightKg?: number | null;
  /** Legacy field name, still accepted so older callers keep working. */
  weight?: number | null;
  dimensionsCm?: DimensionsCm | null;
  weightSource?: WeightSource | string | null;
  partClassKey?: string | null;
  requiresSpecialHandling?: boolean;
}

/** Only explicit catalog restriction flags trigger this block; title keywords do not. */
export function partRequiresSpecialHandling(itemSpecifics: unknown): boolean {
  const positive = (value: unknown) =>
    value === true ||
    (typeof value === 'string' &&
      /^(?:true|yes|required|dangerous goods|hazmat|restricted)$/i.test(
        value.trim(),
      ));
  const source = Array.isArray(itemSpecifics)
    ? Object.fromEntries(
        itemSpecifics
          .filter((entry: any) => entry && typeof entry.field === 'string')
          .map((entry: any) => [entry.field, entry.value]),
      )
    : itemSpecifics;
  if (!source || typeof source !== 'object') return false;

  for (const [key, value] of Object.entries(
    source as Record<string, unknown>,
  )) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (
      [
        'dangerousgoods',
        'hazmat',
        'requiresspecialhandling',
        'shippingrestriction',
      ].includes(normalized) &&
      positive(value)
    ) {
      return true;
    }
  }
  return false;
}

export interface ShippingQuote {
  destinationCountry: string;
  currency: 'AED';
  serviceType: string;
  /** Customer-facing estimated delivery window, e.g. "04 to 06 Business Days". */
  leadTime: string | null;
  matchedCountry: boolean;
  /** Whether a priced carrier service is available for this shipment. */
  available: boolean;
  availabilityReason:
    | 'DESTINATION_UNSUPPORTED'
    | 'FREIGHT_QUOTE_REQUIRED'
    | 'SPECIAL_HANDLING_REVIEW'
    | null;
  totalWeightGrams: number;
  billableWeightGrams: number;
  amount: number;
  /** Whether the charged weight came from actual mass or parcel volume. */
  weightBasis: WeightBasis;
  /** Lowest-trust source across the cart lines. */
  weightSource: WeightSource;
  /** True when any line relied on an estimate rather than a measurement. */
  estimated: boolean;
  /** Safety margin applied because at least one weight was estimated. */
  marginPct: number;
  /** True when no supported parcel rate covers the shipment's billable weight. */
  requiresFreightQuote: boolean;
  /** Billable kg used for eligibility; manual freight quotes are not priced. */
  quotedWeightKg: number;
}

@Injectable()
export class ShippingService {
  private readonly rateBands = [...EMX_RATE_BANDS];
  private readonly highestBand =
    this.rateBands[this.rateBands.length - 1] ?? 2000;
  private readonly lastStep =
    this.highestBand - this.rateBands[this.rateBands.length - 2];
  private readonly rowsByCountry = new Map(
    EMX_RATE_SHEET.map((row) => [this.normalizeCountry(row.country), row]),
  );

  quoteSellerShipping(
    items: ShippingQuoteItem[],
    destinationCountry: string,
  ): ShippingQuote {
    const countryKey = this.normalizeCountry(destinationCountry);
    const chargeableItems = items.filter(
      (item) => item.canonicalPartId !== PAYMENT_TEST_PART_ID,
    );
    const resolved = this.resolveWeights(chargeableItems);

    const row = this.rowsByCountry.get(countryKey);
    const isUae = this.isUae(countryKey);
    const supportedParcelGrams = Math.min(
      maxParcelKgFromEnv() * 1000,
      isUae ? 25_000 : this.highestBand,
    );
    const countrySupported = isUae || Boolean(row);
    const requiresFreightQuote =
      countrySupported && resolved.chargeableGrams > supportedParcelGrams;

    const common = {
      destinationCountry: destinationCountry.trim(),
      currency: 'AED' as const,
      totalWeightGrams: resolved.actualGrams,
      weightBasis: resolved.basis,
      weightSource: resolved.source,
      estimated: resolved.estimated,
      marginPct: resolved.marginPct,
      requiresFreightQuote,
      quotedWeightKg: this.round(resolved.chargeableGrams / 1000),
    };

    if (chargeableItems.length === 0) {
      const row = this.rowsByCountry.get(countryKey);
      return {
        ...common,
        available: true,
        availabilityReason: null,
        serviceType: 'FREE',
        leadTime: this.isUae(countryKey)
          ? '01 to 02 Business Days'
          : (row?.leadTime ?? null),
        matchedCountry: this.isUae(countryKey) || Boolean(row),
        billableWeightGrams: 0,
        amount: 0,
      };
    }

    if (chargeableItems.some((item) => item.requiresSpecialHandling)) {
      return {
        ...common,
        serviceType: 'SPECIAL_HANDLING_REVIEW',
        leadTime: null,
        matchedCountry: false,
        available: false,
        availabilityReason: 'SPECIAL_HANDLING_REVIEW',
        billableWeightGrams: resolved.chargeableGrams,
        amount: 0,
      };
    }

    if (this.isUae(countryKey)) {
      if (requiresFreightQuote) {
        return {
          ...common,
          available: false,
          availabilityReason: 'FREIGHT_QUOTE_REQUIRED',
          serviceType: 'FREIGHT_QUOTE_REQUIRED',
          leadTime: null,
          matchedCountry: true,
          billableWeightGrams: resolved.chargeableGrams,
          amount: 0,
        };
      }

      const tier = this.uaeFlatTier(resolved.chargeableGrams);
      return {
        ...common,
        available: true,
        availabilityReason: null,
        serviceType: `UAE FLAT (${tier.label})`,
        leadTime: '01 to 02 Business Days',
        matchedCountry: true,
        billableWeightGrams: resolved.chargeableGrams,
        amount: tier.amount,
      };
    }

    if (!row) {
      return {
        ...common,
        serviceType: 'UNAVAILABLE',
        leadTime: null,
        matchedCountry: false,
        available: false,
        availabilityReason: 'DESTINATION_UNSUPPORTED' as const,
        billableWeightGrams: resolved.chargeableGrams,
        amount: 0,
      };
    }

    if (requiresFreightQuote) {
      return {
        ...common,
        serviceType: 'FREIGHT_QUOTE_REQUIRED',
        leadTime: null,
        matchedCountry: true,
        available: false,
        availabilityReason: 'FREIGHT_QUOTE_REQUIRED',
        billableWeightGrams: resolved.chargeableGrams,
        amount: 0,
      };
    }

    const billableWeightGrams = this.billableWeight(resolved.chargeableGrams);

    return {
      ...common,
      serviceType: row.serviceType,
      leadTime: row.leadTime,
      matchedCountry: true,
      available: true,
      availabilityReason: null,
      billableWeightGrams,
      amount: this.lookupAmount(row.rates, billableWeightGrams),
    };
  }

  calculateSellerShippingTotal(
    items: ShippingQuoteItem[],
    destinationCountry: string,
  ): number {
    return this.quoteSellerShipping(items, destinationCountry).amount;
  }

  /**
   * Resolves per-line billable weight, filling unknown weights and dimensions
   * from the part class rather than the legacy flat 1kg assumption.
   *
   * `actualGrams` reports true mass for display; `chargeableGrams` is what the
   * carrier bills — max(actual, volumetric) plus a margin when estimated.
   */
  private resolveWeights(items: ShippingQuoteItem[]) {
    const divisor = volumetricDivisorFromEnv();
    const estimatedVolumetricFactor = estimatedVolumetricFactorFromEnv();
    const marginPct = estimateMarginPctFromEnv();

    let actualGrams = 0;
    let chargeableKg = 0;
    let anyVolumetric = false;
    let estimated = false;
    let weakestSource: WeightSource = 'MEASURED';

    for (const item of items) {
      const quantity = Math.max(
        1,
        Number.isFinite(item.quantity) ? item.quantity : 1,
      );
      const line = resolveItemWeight({
        weightKg: item.weightKg ?? item.weight ?? null,
        dimensionsCm: item.dimensionsCm ?? null,
        weightSource: item.weightSource ?? null,
        partClassKey: item.partClassKey ?? null,
        divisor,
        estimatedVolumetricFactor,
      });

      actualGrams += Math.round(line.actualKg * 1000) * quantity;
      chargeableKg += line.billableKg * quantity;
      if (line.basis === 'VOLUMETRIC') anyVolumetric = true;
      if (!isExactWeightSource(line.source) || line.dimensionsEstimated) {
        estimated = true;
      }
      weakestSource = this.weakerSource(weakestSource, line.source);
    }

    const appliedMargin = estimated ? marginPct : 0;
    const chargeableGrams = Math.round(
      chargeableKg * 1000 * (1 + appliedMargin / 100),
    );

    return {
      actualGrams,
      chargeableGrams,
      basis: anyVolumetric ? ('VOLUMETRIC' as const) : ('ACTUAL' as const),
      source: weakestSource,
      estimated,
      marginPct: appliedMargin,
    };
  }

  /** Ordered least-to-most trustworthy; a cart is only as good as its worst line. */
  private readonly sourceRank: Record<WeightSource, number> = {
    CLASS_DEFAULT: 0,
    AI: 1,
    SIBLING_MPN: 2,
    SPREADSHEET: 3,
    SELLER: 4,
    MEASURED: 5,
  };

  private weakerSource(a: WeightSource, b: WeightSource): WeightSource {
    return this.sourceRank[b] < this.sourceRank[a] ? b : a;
  }

  private billableWeight(totalWeightGrams: number) {
    const safeWeight = Math.max(100, totalWeightGrams);
    const band = this.rateBands.find((grams) => safeWeight <= grams);
    if (band) return band;
    const overflow = safeWeight - this.highestBand;
    return (
      this.highestBand + Math.ceil(overflow / this.lastStep) * this.lastStep
    );
  }

  private lookupAmount(
    rates: Record<number, number>,
    billableWeightGrams: number,
  ): number {
    const direct = rates[billableWeightGrams];
    if (typeof direct === 'number') return direct;

    const cappedBase = rates[this.highestBand] ?? 0;
    const priorBand = this.rateBands[this.rateBands.length - 2] ?? 1800;
    const priorAmount = rates[priorBand] ?? cappedBase;
    const increment = cappedBase - priorAmount;
    const extraSteps = Math.max(
      0,
      Math.ceil((billableWeightGrams - this.highestBand) / this.lastStep),
    );
    return this.round(cappedBase + increment * extraSteps);
  }

  private normalizeCountry(country: string) {
    const normalized = country.trim().toLowerCase().replace(/\s+/g, ' ');
    return COUNTRY_ALIASES[normalized] ?? normalized;
  }

  private isUae(countryKey: string) {
    return UAE_COUNTRY_ALIASES.has(countryKey);
  }

  private uaeFlatTier(totalWeightGrams: number) {
    const weightKg = Math.max(totalWeightGrams, 0) / 1000;
    return UAE_FLAT_TIERS.find((tier) => weightKg <= tier.maxKg)!;
  }

  private round(value: number) {
    return Math.round(value * 100) / 100;
  }
}
