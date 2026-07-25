import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

// Mirrors OpenSearchService#indexPart's buyer-visibility rule: a part with
// no ACTIVE offer from an onboarded, non-seed seller is removed from the
// index entirely, so it can never appear in search results.
const BUYER_VISIBLE_OFFER = {
  status: 'ACTIVE',
  sellerId: { not: 'seed-febest-inventory-supplier' },
  seller: {
    onboardingStatus: 'ACTIVE',
    NOT: {
      name: {
        contains: 'febest inventory supplier',
        mode: 'insensitive' as const,
      },
    },
  },
};

// Mirrors the guaranteed-fit criteria OpenSearch indexing uses (see
// opensearch.service.ts indexPart): only A/B evidence at >=0.8 confidence
// ever surfaces in search results, and only for parts with a buyer-visible
// offer. A config whose only fitments fall short of either bar would let a
// buyer complete the picker and land on an empty search page, so the
// picker must require exactly what search requires.
const SEARCH_GRADE_FITMENT = {
  evidenceLevel: { in: ['A', 'B'] as string[] },
  confidence: { gte: 0.8 },
  canonicalPart: { offers: { some: BUYER_VISIBLE_OFFER } },
};

@Injectable()
export class VehicleService {
  constructor(private prisma: PrismaService) {}

  async getMakes() {
    return this.prisma.vehicleMake.findMany({
      where: {
        models: {
          some: {
            generations: {
              some: {
                configurations: {
                  some: { fitments: { some: SEARCH_GRADE_FITMENT } },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getModelsByMake(makeId: string) {
    return this.prisma.vehicleModel.findMany({
      where: {
        makeId,
        generations: {
          some: {
            configurations: {
              some: { fitments: { some: SEARCH_GRADE_FITMENT } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getGenerationsByModel(modelId: string) {
    return this.prisma.vehicleGeneration.findMany({
      where: {
        modelId,
        configurations: { some: { fitments: { some: SEARCH_GRADE_FITMENT } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getConfigurationsByGeneration(generationId: string) {
    return this.prisma.vehicleConfiguration.findMany({
      where: { generationId, fitments: { some: SEARCH_GRADE_FITMENT } },
    });
  }
}
