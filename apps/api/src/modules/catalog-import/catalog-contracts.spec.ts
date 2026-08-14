import { CatalogMatchService } from './catalog-match.service';
import {
  isVerifiedFitmentEvidence,
  partTypeFromLegacy,
  partTypeLabel,
} from '@repo/catalog-contracts';

describe('catalog contracts', () => {
  it('labels controlled part types for buyer/admin UI', () => {
    // 'New Aftermarket' since 67cc2cc. This assertion said 'Aftermarket' and
    // still passed, because jest resolved @repo/catalog-contracts to a stale
    // `dist/` build; the suite now maps the package to its source.
    expect(partTypeLabel('AFTERMARKET')).toBe('New Aftermarket');
    expect(partTypeLabel('SALVAGE_OEM')).toBe('Used Genuine OEM');
    expect(partTypeFromLegacy('AFTERMARKET', null)).toBe('AFTERMARKET');
    expect(partTypeFromLegacy('OEM', 'UNCLASSIFIED')).toBe('UNCLASSIFIED');
  });

  it('only treats strong A/B evidence as verified fit', () => {
    expect(isVerifiedFitmentEvidence('A', 0.9)).toBe(true);
    expect(isVerifiedFitmentEvidence('D', 0.9)).toBe(false);
    expect(isVerifiedFitmentEvidence('B', 0.5)).toBe(false);
  });
});

describe('CatalogMatchService.pickAutoMatch', () => {
  const service = new CatalogMatchService({} as any);

  it('auto-matches only exact unblocked candidates', () => {
    expect(
      service.pickAutoMatch([
        {
          canonicalPartId: '1',
          title: 'A',
          score: 1,
          band: 'EXACT',
          blockers: [],
          features: [],
        },
      ])?.canonicalPartId,
    ).toBe('1');

    expect(
      service.pickAutoMatch([
        {
          canonicalPartId: '2',
          title: 'B',
          score: 0.8,
          band: 'PROBABLE',
          blockers: [],
          features: [],
        },
      ]),
    ).toBeNull();

    expect(
      service.pickAutoMatch([
        {
          canonicalPartId: '3',
          title: 'C',
          score: 1,
          band: 'EXACT',
          blockers: ['Position conflict'],
          features: [],
        },
      ]),
    ).toBeNull();
  });
});

describe('CatalogMatchService.findCandidates', () => {
  it('blocks an MPN match across brand namespaces and OEM-number rows', async () => {
    const prisma = {
      catalogPartNumber: {
        findMany: jest.fn().mockResolvedValue([
          {
            canonicalPartId: 'different-brand',
            numberType: 'BRAND_MPN',
            brandId: 'brand-brembo',
            brand: { displayName: 'BREMBO' },
            canonicalPart: {
              id: 'different-brand',
              title: 'BREMBO sensor',
              brand: 'BREMBO',
              manufacturerPartNumber: '7L0907637C',
              partType: 'AFTERMARKET',
              position: null,
            },
          },
          {
            canonicalPartId: 'same-brand-oem-number',
            numberType: 'OEM',
            brandId: 'brand-schnieder',
            brand: { displayName: 'SCHNIEDER' },
            canonicalPart: {
              id: 'same-brand-oem-number',
              title: 'SCHNIEDER sensor',
              brand: 'SCHNIEDER',
              manufacturerPartNumber: '7L0907637C',
              partType: 'AFTERMARKET',
              position: null,
            },
          },
        ]),
      },
    };
    const service = new CatalogMatchService(prisma as any);

    const candidates = await service.findCandidates({
      brandId: 'brand-schnieder',
      brandName: 'SCHNIEDER',
      manufacturerPartNumber: '7L0 907 637 C',
    });

    expect(candidates.every((candidate) => candidate.band !== 'EXACT')).toBe(true);
    expect(service.pickAutoMatch(candidates)).toBeNull();
    expect(candidates[0].blockers).toContain(
      'Same normalized number under a different brand namespace',
    );
    expect(candidates[1].blockers).toContain(
      'Number is not a trusted brand MPN namespace',
    );
  });
});
