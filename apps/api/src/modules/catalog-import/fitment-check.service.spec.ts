import { FitmentCheckService } from './fitment-check.service';

describe('FitmentCheckService buyer evidence boundary', () => {
  const makeService = (fitment: Record<string, unknown>) => {
    const prisma = {
      canonicalPart: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'part-1',
          partNumbers: [],
          fitments: [
            {
              vehicleConfigId: 'vehicle-1',
              evidenceLevel: 'B',
              confidence: 0.95,
              source: 'TITLE_MVL',
              reason: 'Supplier title matched MVL vehicle identity',
              evidence: [],
              ...fitment,
            },
          ],
        }),
      },
    };
    return new FitmentCheckService(prisma as any);
  };

  it('does not promote MVL vehicle identity into confirmed part fitment', async () => {
    const result = await makeService({}).check('part-1', 'vehicle-1');

    expect(result.status).toBe('LIKELY');
    expect(result.evidence).toEqual([
      {
        evidenceType: 'COMPATIBILITY_RECORD',
        evidenceLevel: 'B',
        confidence: 0.95,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /TITLE_MVL|Supplier title|source|reason/i,
    );
  });

  it('confirms only allowlisted exact relationship evidence', async () => {
    const result = await makeService({
      source: 'MANUFACTURER_EXACT_FITMENT',
    }).check('part-1', 'vehicle-1');

    expect(result.status).toBe('CONFIRMED');
    expect(result.evidence[0].evidenceType).toBe('EXACT_CATALOG_APPLICATION');
  });
});
