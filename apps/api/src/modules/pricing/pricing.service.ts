import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export const PRICING_MODES = [
  'COMMISSION_ON_SELLING_PRICE',
  'COST_PLUS_MARKUP',
  'TARGET_MARGIN',
  'FIXED_FEE',
  'HYBRID_PERCENT_PLUS_FIXED',
] as const;

export type PricingMode = (typeof PRICING_MODES)[number];

export interface PriceQuote {
  sellerBasePrice: number;
  customerPrice: number;
  marketplaceFee: number;
  sellerProceeds: number;
  currency: string;
  pricingPolicyId: string | null;
  pricingPolicyVersion: number | null;
  pricingMode: PricingMode | 'UNMANAGED';
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSellerPricing(sellerId: string) {
    return this.prisma.sellerPricingAssignment.findMany({
      where: { sellerId },
      include: { pricingPolicy: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async quote(sellerId: string, category: string | null | undefined, sellerBasePrice: number): Promise<PriceQuote> {
    if (!Number.isFinite(sellerBasePrice) || sellerBasePrice < 0) {
      throw new BadRequestException('sellerBasePrice must be a non-negative number');
    }

    const now = new Date();
    const assignments = await this.prisma.sellerPricingAssignment.findMany({
      where: {
        sellerId,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      include: { pricingPolicy: true },
    });

    const active = assignments
      .filter(({ pricingPolicy }) => (
        pricingPolicy.status === 'ACTIVE'
        && pricingPolicy.effectiveFrom <= now
        && (!pricingPolicy.effectiveTo || pricingPolicy.effectiveTo > now)
      ))
      .filter((assignment) => !assignment.category || assignment.category === category)
      .sort((a, b) => {
        const categorySpecificity = Number(Boolean(b.category)) - Number(Boolean(a.category));
        if (categorySpecificity !== 0) return categorySpecificity;
        return b.pricingPolicy.priority - a.pricingPolicy.priority;
      })[0];

    if (!active) {
      const amount = this.round(sellerBasePrice);
      return {
        sellerBasePrice: amount,
        customerPrice: amount,
        marketplaceFee: 0,
        sellerProceeds: amount,
        currency: 'USD',
        pricingPolicyId: null,
        pricingPolicyVersion: null,
        pricingMode: 'UNMANAGED',
      };
    }

    const policy = active.pricingPolicy;
    const mode = policy.mode as PricingMode;
    if (!PRICING_MODES.includes(mode)) {
      throw new BadRequestException(`Unsupported pricing mode: ${policy.mode}`);
    }
    if (policy.percentRate < 0 || policy.percentRate >= 1) {
      throw new BadRequestException('Pricing policy percentRate must be between 0 and 0.9999');
    }

    let customerPrice = sellerBasePrice;
    let marketplaceFee = 0;
    let sellerProceeds = sellerBasePrice;

    switch (mode) {
      case 'COMMISSION_ON_SELLING_PRICE':
      case 'HYBRID_PERCENT_PLUS_FIXED':
        marketplaceFee = sellerBasePrice * policy.percentRate + policy.fixedFee;
        sellerProceeds = sellerBasePrice - marketplaceFee;
        break;
      case 'FIXED_FEE':
        marketplaceFee = policy.fixedFee;
        sellerProceeds = sellerBasePrice - marketplaceFee;
        break;
      case 'COST_PLUS_MARKUP':
        customerPrice = sellerBasePrice * (1 + policy.percentRate) + policy.fixedFee;
        marketplaceFee = customerPrice - sellerBasePrice;
        break;
      case 'TARGET_MARGIN':
        customerPrice = (sellerBasePrice + policy.fixedFee) / (1 - policy.percentRate);
        marketplaceFee = customerPrice - sellerBasePrice;
        break;
    }

    if (policy.minimumPrice !== null) {
      customerPrice = Math.max(customerPrice, policy.minimumPrice);
      if (mode === 'COST_PLUS_MARKUP' || mode === 'TARGET_MARGIN') {
        marketplaceFee = customerPrice - sellerBasePrice;
      }
    }
    if (policy.maximumFee !== null) {
      marketplaceFee = Math.min(marketplaceFee, policy.maximumFee);
      if (mode === 'COST_PLUS_MARKUP' || mode === 'TARGET_MARGIN') {
        customerPrice = sellerBasePrice + marketplaceFee;
      } else {
        sellerProceeds = sellerBasePrice - marketplaceFee;
      }
    }

    if (sellerProceeds < 0) {
      throw new BadRequestException('Pricing policy produces negative seller proceeds');
    }

    return {
      sellerBasePrice: this.round(sellerBasePrice),
      customerPrice: this.round(customerPrice),
      marketplaceFee: this.round(marketplaceFee),
      sellerProceeds: this.round(sellerProceeds),
      currency: policy.currency,
      pricingPolicyId: policy.id,
      pricingPolicyVersion: policy.version,
      pricingMode: mode,
    };
  }

  async repriceOffer(offerId: string, sellerBasePrice?: number) {
    const offer = await this.prisma.sellerOffer.findUnique({
      where: { id: offerId },
      include: { canonicalPart: true },
    });
    if (!offer) throw new BadRequestException('Offer not found');

    const base = sellerBasePrice ?? offer.sellerBasePrice ?? offer.price;
    const quote = await this.quote(offer.sellerId, offer.canonicalPart.category, base);
    return this.prisma.sellerOffer.update({
      where: { id: offer.id },
      data: {
        price: quote.customerPrice,
        sellerBasePrice: quote.sellerBasePrice,
        marketplaceFee: quote.marketplaceFee,
        sellerProceeds: quote.sellerProceeds,
        pricingPolicyId: quote.pricingPolicyId,
        pricingPolicyVersion: quote.pricingPolicyVersion,
        pricedAt: new Date(),
        currency: quote.pricingPolicyId ? quote.currency : offer.currency,
      },
      include: { canonicalPart: true, inventory: true, pricingPolicy: true },
    });
  }

  async repriceSeller(sellerId: string) {
    const offers = await this.prisma.sellerOffer.findMany({ where: { sellerId }, select: { id: true } });
    let repricedOffers = 0;
    for (const offer of offers) {
      await this.repriceOffer(offer.id);
      repricedOffers += 1;
    }
    return repricedOffers;
  }

  private round(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
