import { MvlFitmentService } from './mvl-fitment.service';

describe('MvlFitmentService evidence preservation', () => {
  it('preserves existing exact relationship evidence when MVL validates identity', async () => {
    const exact = {
      id: 'fitment-1',
      vehicleConfigId: 'vehicle-1',
      evidenceLevel: 'A',
      confidence: 0.98,
      source: 'MANUFACTURER_EXACT_FITMENT',
      evidence: [],
    };
    const prisma = {
      fitment: {
        findUnique: jest.fn().mockResolvedValue(exact),
        upsert: jest.fn(),
      },
      fitmentEvidence: { create: jest.fn() },
    };
    const service = new MvlFitmentService(prisma as any);

    const result = await service.upsertVerifiedFitments({
      canonicalPartId: 'part-1',
      configs: [{ vehicleConfigId: 'vehicle-1' }],
      source: 'TITLE_MVL',
      reviewer: 'MVL import',
    });

    expect(prisma.fitment.upsert).not.toHaveBeenCalled();
    expect(prisma.fitmentEvidence.create).not.toHaveBeenCalled();
    expect(result).toEqual([
      { vehicleConfigId: 'vehicle-1', evidenceLevel: 'A', confidence: 0.98 },
    ]);
  });

  it('stores MVL vehicle identity as likely evidence for a new relationship', async () => {
    const prisma = {
      fitment: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: 'fitment-new',
          vehicleConfigId: 'vehicle-1',
          evidenceLevel: 'C',
          confidence: 0.65,
        }),
      },
      fitmentEvidence: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new MvlFitmentService(prisma as any);

    const result = await service.upsertVerifiedFitments({
      canonicalPartId: 'part-1',
      configs: [{ vehicleConfigId: 'vehicle-1' }],
      source: 'TITLE_MVL',
      reviewer: 'MVL import',
    });

    expect(prisma.fitment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          evidenceLevel: 'C',
          confidence: 0.65,
          verificationStatus: 'LIKELY',
        }),
      }),
    );
    expect(prisma.fitmentEvidence.create).toHaveBeenCalled();
    expect(result).toEqual([
      { vehicleConfigId: 'vehicle-1', evidenceLevel: 'C', confidence: 0.65 },
    ]);
  });
});
