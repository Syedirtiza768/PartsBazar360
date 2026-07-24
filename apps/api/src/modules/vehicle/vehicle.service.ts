import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

// Mirrors the guaranteed-fit criteria OpenSearch indexing uses (see
// opensearch.service.ts indexPart): only A/B evidence at >=0.8 confidence
// ever surfaces in search results. A config with only weaker, title-inferred
// fitments would let a buyer complete the picker and land on an empty
// search page, so the picker must require the same bar search does.
const SEARCH_GRADE_FITMENT = {
  evidenceLevel: { in: ['A', 'B'] as string[] },
  confidence: { gte: 0.8 },
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
                configurations: { some: { fitments: { some: SEARCH_GRADE_FITMENT } } },
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
          some: { configurations: { some: { fitments: { some: SEARCH_GRADE_FITMENT } } } },
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
