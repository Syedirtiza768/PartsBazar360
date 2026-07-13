import { Injectable } from '@nestjs/common';

@Injectable()
export class ShippingService {
  // Simple weight-based calculation mock logic
  // e.g. Base rate 20 AED, plus 5 AED per kg.
  private readonly BASE_RATE = 20;
  private readonly RATE_PER_KG = 5;

  calculateShippingCost(totalWeightInKg: number): number {
    if (totalWeightInKg <= 0) return this.BASE_RATE;
    return this.BASE_RATE + (totalWeightInKg * this.RATE_PER_KG);
  }

  // Multi-seller carts mean each seller ships their own package.
  // We calculate weight per seller group.
  calculateSellerShippingTotal(items: { weight?: number, quantity: number }[]): number {
    let totalWeight = 0;
    for (const item of items) {
      if (item.weight) {
        totalWeight += (item.weight * item.quantity);
      } else {
        // Fallback default weight if none provided: 1kg
        totalWeight += (1 * item.quantity);
      }
    }
    return this.calculateShippingCost(totalWeight);
  }
}
