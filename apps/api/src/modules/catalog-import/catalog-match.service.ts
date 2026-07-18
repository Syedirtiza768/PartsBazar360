import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { normalizePartNumber } from './part-normalization.util';

export interface MatchCandidate {
  canonicalPartId: string;
  title: string;
  brand?: string | null;
  manufacturerPartNumber?: string | null;
  partType?: string | null;
  score: number;
  band: 'EXACT' | 'PROBABLE' | 'POSSIBLE';
  blockers: string[];
  features: string[];
}

@Injectable()
export class CatalogMatchService {
  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(input: {
    brandId?: string | null;
    brandName?: string | null;
    manufacturerPartNumber?: string | null;
    oemNumbers?: string[];
    position?: string | null;
  }): Promise<MatchCandidate[]> {
    const normalizedMpn = input.manufacturerPartNumber ? normalizePartNumber(input.manufacturerPartNumber) : '';
    if (!normalizedMpn) return [];

    const byMpn = await this.prisma.catalogPartNumber.findMany({
      where: {
        normalizedNumber: normalizedMpn,
        numberType: { in: ['BRAND_MPN', 'OEM'] },
      },
      include: {
        canonicalPart: true,
        brand: true,
      },
      take: 10,
    });

    const candidates: MatchCandidate[] = [];
    for (const row of byMpn) {
      const features: string[] = [`Normalized ${row.numberType} match: ${normalizedMpn}`];
      const blockers: string[] = [];
      let score = 0.7;

      if (input.brandId && row.brandId && input.brandId === row.brandId) {
        score = 1;
        features.push('Exact brand namespace + MPN');
      } else if (input.brandName && row.brand?.displayName && row.brand.displayName.toLowerCase() === input.brandName.toLowerCase()) {
        score = 0.95;
        features.push('Brand display name + MPN');
      } else if (input.brandId || input.brandName) {
        if (row.brandId) {
          blockers.push('Same normalized number under a different brand namespace');
          score = 0.35;
        } else {
          features.push('MPN match without brand namespace on existing record');
          score = 0.55;
        }
      }

      if (input.position && row.canonicalPart.position && input.position !== row.canonicalPart.position) {
        blockers.push(`Position conflict (${input.position} vs ${row.canonicalPart.position})`);
        score = Math.min(score, 0.2);
      }

      const band: MatchCandidate['band'] = blockers.length
        ? 'POSSIBLE'
        : score >= 0.95
          ? 'EXACT'
          : score >= 0.7
            ? 'PROBABLE'
            : 'POSSIBLE';

      candidates.push({
        canonicalPartId: row.canonicalPartId,
        title: row.canonicalPart.title,
        brand: row.canonicalPart.brand,
        manufacturerPartNumber: row.canonicalPart.manufacturerPartNumber,
        partType: row.canonicalPart.partType,
        score,
        band,
        blockers,
        features,
      });
    }

    if (input.oemNumbers?.length) {
      const oemHits = await this.prisma.catalogPartNumber.findMany({
        where: {
          numberType: { in: ['OEM', 'OEM_CROSS_REFERENCE'] },
          normalizedNumber: { in: input.oemNumbers.map(normalizePartNumber) },
        },
        include: { canonicalPart: true },
        take: 5,
      });
      for (const hit of oemHits) {
        if (candidates.some((c) => c.canonicalPartId === hit.canonicalPartId)) continue;
        candidates.push({
          canonicalPartId: hit.canonicalPartId,
          title: hit.canonicalPart.title,
          brand: hit.canonicalPart.brand,
          manufacturerPartNumber: hit.canonicalPart.manufacturerPartNumber,
          partType: hit.canonicalPart.partType,
          score: 0.45,
          band: 'POSSIBLE',
          blockers: ['OEM/cross-reference only — never auto-merge across brands'],
          features: [`OEM/cross-reference number ${hit.displayNumber}`],
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  pickAutoMatch(candidates: MatchCandidate[]) {
    const exact = candidates.find((c) => c.band === 'EXACT' && c.blockers.length === 0);
    return exact || null;
  }
}
