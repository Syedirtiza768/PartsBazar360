import { Injectable } from '@nestjs/common';
import { EMX_RATE_BANDS, EMX_RATE_SHEET } from './emx-rate-sheet';

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
    items: { weight?: number; quantity: number }[],
    destinationCountry: string,
  ) {
    const totalWeightGrams = this.totalWeightGrams(items);
    const billableWeightGrams = this.billableWeight(totalWeightGrams);
    const countryKey = this.normalizeCountry(destinationCountry);
    const row = this.rowsByCountry.get(countryKey);
    const rates = row?.rates ?? this.averageRates;

    return {
      destinationCountry: destinationCountry.trim(),
      currency: 'AED',
      serviceType: row?.serviceType ?? 'REGISTERED (POD)',
      matchedCountry: Boolean(row),
      totalWeightGrams,
      billableWeightGrams,
      amount: this.lookupAmount(rates, billableWeightGrams),
    };
  }

  calculateSellerShippingTotal(
    items: { weight?: number; quantity: number }[],
    destinationCountry: string,
  ): number {
    return this.quoteSellerShipping(items, destinationCountry).amount;
  }

  private totalWeightGrams(items: { weight?: number; quantity: number }[]) {
    let total = 0;
    for (const item of items) {
      const unitWeightKg =
        typeof item.weight === 'number' && item.weight > 0 ? item.weight : 1;
      total += Math.round(unitWeightKg * 1000) * item.quantity;
    }
    return total;
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
        values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      out[band] = this.round(avg);
    }
    return out;
  }

  private normalizeCountry(country: string) {
    return country.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private round(value: number) {
    return Math.round(value * 100) / 100;
  }
}
