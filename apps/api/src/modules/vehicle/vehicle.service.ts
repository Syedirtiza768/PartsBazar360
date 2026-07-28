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

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expires: number;
}

@Injectable()
export class VehicleService {
  private makesCache: CacheEntry<unknown[]> | null = null;
  private modelsCache = new Map<string, CacheEntry<unknown[]>>();
  private gensCache = new Map<string, CacheEntry<unknown[]>>();
  private configsCache = new Map<string, CacheEntry<unknown[]>>();

  constructor(private prisma: PrismaService) {}

  private getCached<T>(entry: CacheEntry<T> | null | undefined): T | null {
    if (entry && entry.expires > Date.now()) return entry.data;
    return null;
  }

  async getMakes() {
    const cached = this.getCached(this.makesCache);
    if (cached) return cached;

    const data = await this.prisma.vehicleMake.findMany({
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
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    this.makesCache = { data, expires: Date.now() + CACHE_TTL_MS };
    return data;
  }

  async getModelsByMake(makeId: string) {
    const cached = this.getCached(this.modelsCache.get(makeId));
    if (cached) return cached;

    const data = await this.prisma.vehicleModel.findMany({
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
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    this.modelsCache.set(makeId, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  }

  async getGenerationsByModel(modelId: string) {
    const cached = this.getCached(this.gensCache.get(modelId));
    if (cached) return cached;

    const data = await this.prisma.vehicleGeneration.findMany({
      where: {
        modelId,
        configurations: { some: { fitments: { some: SEARCH_GRADE_FITMENT } } },
      },
      select: { id: true, name: true, startYear: true, endYear: true },
      orderBy: { name: 'asc' },
    });
    this.gensCache.set(modelId, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  }

  async getConfigurationsByGeneration(generationId: string) {
    const cached = this.getCached(this.configsCache.get(generationId));
    if (cached) return cached;

    const data = await this.prisma.vehicleConfiguration.findMany({
      where: { generationId, fitments: { some: SEARCH_GRADE_FITMENT } },
      select: {
        id: true,
        trim: true,
        engine: true,
        transmission: true,
      },
    });
    this.configsCache.set(generationId, {
      data,
      expires: Date.now() + CACHE_TTL_MS,
    });
    return data;
  }
}
