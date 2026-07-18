import { CatalogMatchService } from './catalog-match.service';
import { isVerifiedFitmentEvidence, partTypeFromLegacy, partTypeLabel } from '@repo/catalog-contracts';

describe('catalog contracts', () => {
  it('labels controlled part types for buyer/admin UI', () => {
    expect(partTypeLabel('AFTERMARKET')).toBe('Aftermarket');
    expect(partTypeLabel('SALVAGE_OEM')).toBe('Used Original');
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
    expect(service.pickAutoMatch([
      { canonicalPartId: '1', title: 'A', score: 1, band: 'EXACT', blockers: [], features: [] },
    ])?.canonicalPartId).toBe('1');

    expect(service.pickAutoMatch([
      { canonicalPartId: '2', title: 'B', score: 0.8, band: 'PROBABLE', blockers: [], features: [] },
    ])).toBeNull();

    expect(service.pickAutoMatch([
      { canonicalPartId: '3', title: 'C', score: 1, band: 'EXACT', blockers: ['Position conflict'], features: [] },
    ])).toBeNull();
  });
});
