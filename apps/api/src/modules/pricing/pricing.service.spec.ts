import { PricingService } from './pricing.service';

function serviceWithPolicy(policy: Partial<any> | null) {
  const pricingPolicy = policy ? {
    id: 'policy-1', code: 'TEST', name: 'Test policy', version: 3,
    mode: 'COMMISSION_ON_SELLING_PRICE', percentRate: 0.3, fixedFee: 0,
    currency: 'USD', category: null, minimumPrice: null, maximumFee: null,
    status: 'ACTIVE', priority: 10, effectiveFrom: new Date('2026-01-01'), effectiveTo: null,
    ...policy,
  } : null;
  const prisma = {
    sellerPricingAssignment: {
      findMany: jest.fn().mockResolvedValue(pricingPolicy ? [{
        id: 'assignment-1', sellerId: 'seller-1', category: null, status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'), effectiveTo: null, pricingPolicy,
      }] : []),
    },
  };
  return new PricingService(prisma as any);
}

describe('PricingService', () => {
  it('calculates a 30% commission without changing the buyer price', async () => {
    const quote = await serviceWithPolicy(null).quote('seller-1', null, 100);
    expect(quote).toMatchObject({ customerPrice: 100, marketplaceFee: 0, sellerProceeds: 100, pricingMode: 'UNMANAGED' });

    const managed = await serviceWithPolicy({}).quote('seller-1', null, 100);
    expect(managed).toMatchObject({ customerPrice: 100, marketplaceFee: 30, sellerProceeds: 70, pricingPolicyVersion: 3 });
  });

  it('distinguishes a 30% markup from a 30% target margin', async () => {
    const markup = await serviceWithPolicy({ mode: 'COST_PLUS_MARKUP' }).quote('seller-1', null, 100);
    expect(markup).toMatchObject({ customerPrice: 130, marketplaceFee: 30, sellerProceeds: 100 });

    const margin = await serviceWithPolicy({ mode: 'TARGET_MARGIN' }).quote('seller-1', null, 100);
    expect(margin).toMatchObject({ customerPrice: 142.86, marketplaceFee: 42.86, sellerProceeds: 100 });
  });

  it('applies fixed fees and caps without producing hidden negative proceeds', async () => {
    const quote = await serviceWithPolicy({ mode: 'HYBRID_PERCENT_PLUS_FIXED', fixedFee: 5, maximumFee: 20 }).quote('seller-1', null, 100);
    expect(quote).toMatchObject({ customerPrice: 100, marketplaceFee: 20, sellerProceeds: 80 });
  });
});
