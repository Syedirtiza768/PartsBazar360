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
  { maxKg: Number.POSITIVE_INFINITY, amount: 150, label: 'heavy' },
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
 * would help — those fall back to `averageRates`/`AVERAGE_LEAD_TIME` below.
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

/**
 * Delivery window shown alongside `averageRates` for destinations with no
 * EMX row at all. Deliberately the widest band on the sheet (see
 * buildAverageRates' sibling) since there's no carrier data for these
 * markets to average — better to under-promise than quote a number we can't
 * back up.
 */
const AVERAGE_LEAD_TIME = '08 to 14 Business Days';

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
}

export interface ShippingQuote {
  destinationCountry: string;
  currency: 'AED';
  serviceType: string;
  /** Customer-facing estimated delivery window, e.g. "04 to 06 Business Days". */
  leadTime: string | null;
  matchedCountry: boolean;
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
  /**
   * True when the parcel exceeds the courier ceiling. `amount` is then only the
   * price at that ceiling — a floor, not a quotable total. Callers must route
   * these to a manual freight quote rather than charging the buyer.
   */
  requiresFreightQuote: boolean;
  /** Billable kg the quote was priced at, after any freight capping. */
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
  private readonly averageRates = this.buildAverageRates();

  quoteSellerShipping(
    items: ShippingQuoteItem[],
    destinationCountry: string,
  ): ShippingQuote {
    const countryKey = this.normalizeCountry(destinationCountry);
    const chargeableItems = items.filter(
      (item) => item.canonicalPartId !== PAYMENT_TEST_PART_ID,
    );
    const resolved = this.resolveWeights(chargeableItems);

    const maxParcelGrams = maxParcelKgFromEnv() * 1000;
    const requiresFreightQuote = resolved.chargeableGrams > maxParcelGrams;
    // Price at the ceiling rather than extrapolating the rate sheet into
    // freight territory; the flag tells callers this is a floor.
    const pricedGrams = requiresFreightQuote
      ? maxParcelGrams
      : resolved.chargeableGrams;

    const common = {
      destinationCountry: destinationCountry.trim(),
      currency: 'AED' as const,
      totalWeightGrams: resolved.actualGrams,
      weightBasis: resolved.basis,
      weightSource: resolved.source,
      estimated: resolved.estimated,
      marginPct: resolved.marginPct,
      requiresFreightQuote,
      quotedWeightKg: this.round(pricedGrams / 1000),
    };

    if (chargeableItems.length === 0) {
      const row = this.rowsByCountry.get(countryKey);
      return {
        ...common,
        serviceType: 'FREE',
        leadTime: this.isUae(countryKey)
          ? '01 to 02 Business Days'
          : (row?.leadTime ?? AVERAGE_LEAD_TIME),
        matchedCountry: this.isUae(countryKey) || Boolean(row),
        billableWeightGrams: 0,
        amount: 0,
      };
    }

    if (this.isUae(countryKey)) {
      const tier = this.uaeFlatTier(pricedGrams);
      return {
        ...common,
        serviceType: `UAE FLAT (${tier.label})`,
        leadTime: '01 to 02 Business Days',
        matchedCountry: true,
        billableWeightGrams: pricedGrams,
        amount: tier.amount,
      };
    }

    const billableWeightGrams = this.billableWeight(pricedGrams);
    const row = this.rowsByCountry.get(countryKey);
    const rates = row?.rates ?? this.averageRates;

    return {
      ...common,
      serviceType: row?.serviceType ?? 'REGISTERED (POD)',
      leadTime: row?.leadTime ?? AVERAGE_LEAD_TIME,
      matchedCountry: Boolean(row),
      billableWeightGrams,
      amount: this.lookupAmount(rates, billableWeightGrams),
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

  private buildAverageRates() {
    const out: Record<number, number> = {};
    for (const band of this.rateBands) {
      const values = EMX_RATE_SHEET.map((row) => row.rates[band]).filter(
        (value): value is number => typeof value === 'number',
      );
      const avg =
        values.reduce((sum, value) => sum + value, 0) /
        Math.max(1, values.length);
      out[band] = this.round(avg);
    }
    return out;
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
    return (
      UAE_FLAT_TIERS.find((tier) => weightKg <= tier.maxKg) ??
      UAE_FLAT_TIERS[UAE_FLAT_TIERS.length - 1]
    );
  }

  private round(value: number) {
    return Math.round(value * 100) / 100;
  }
}
