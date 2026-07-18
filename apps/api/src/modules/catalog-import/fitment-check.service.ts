import { Injectable, NotFoundException } from '@nestjs/common';
import { isVerifiedFitmentEvidence, type FitmentStatus } from '@repo/catalog-contracts';
import { PrismaService } from '../../prisma.service';

export interface FitmentCheckResult {
  status: FitmentStatus;
  explanation: string;
  evidence: Array<{
    evidenceType: string;
    evidenceLevel: string;
    confidence: number;
    source?: string | null;
    reason?: string | null;
  }>;
  missingAttributes: string[];
  conflicts: string[];
  vehicleConfigId?: string;
}

@Injectable()
export class FitmentCheckService {
  constructor(private readonly prisma: PrismaService) {}

  async check(partId: string, vehicleConfigId?: string): Promise<FitmentCheckResult> {
    const part = await this.prisma.canonicalPart.findUnique({
      where: { id: partId },
      include: {
        fitments: {
          include: { evidence: true, vehicleConfig: true },
        },
        partNumbers: true,
      },
    });
    if (!part) throw new NotFoundException(`Part ${partId} not found`);

    if (!vehicleConfigId) {
      return {
        status: 'DETAILS_REQUIRED',
        explanation: 'Select your vehicle to check compatibility.',
        evidence: [],
        missingAttributes: ['vehicleConfigId'],
        conflicts: [],
      };
    }

    const fitment = part.fitments.find((f) => f.vehicleConfigId === vehicleConfigId);
    if (!fitment) {
      const hasOemXref = part.partNumbers.some((n) => n.numberType === 'OEM_CROSS_REFERENCE' || n.numberType === 'OEM');
      if (hasOemXref) {
        return {
          status: 'OEM_NUMBER_MATCH',
          explanation: 'An OEM number is associated with this part, but complete vehicle fitment has not been verified for your configuration.',
          evidence: [{ evidenceType: 'OEM_CROSS_REFERENCE', evidenceLevel: 'E', confidence: 0.4, reason: 'OEM reference without vehicle configuration match' }],
          missingAttributes: [],
          conflicts: [],
          vehicleConfigId,
        };
      }
      return {
        status: 'NOT_VERIFIED',
        explanation: 'Fitment information is not available for this listing against your selected vehicle.',
        evidence: [],
        missingAttributes: [],
        conflicts: [],
        vehicleConfigId,
      };
    }

    const evidence = fitment.evidence.length
      ? fitment.evidence.map((e) => ({
          evidenceType: e.evidenceType,
          evidenceLevel: e.evidenceLevel,
          confidence: e.confidence,
          source: e.source,
          reason: e.reason,
        }))
      : [{
          evidenceType: fitment.source || 'LEGACY_FITMENT',
          evidenceLevel: fitment.evidenceLevel,
          confidence: fitment.confidence,
          source: fitment.source,
          reason: fitment.reason,
        }];

    if (isVerifiedFitmentEvidence(fitment.evidenceLevel, fitment.confidence)) {
      return {
        status: 'CONFIRMED',
        explanation: 'Confirmed to fit your selected vehicle based on verified catalog evidence.',
        evidence,
        missingAttributes: [],
        conflicts: [],
        vehicleConfigId,
      };
    }

    if (fitment.evidenceLevel === 'C' || (fitment.confidence >= 0.6 && fitment.confidence < 0.8)) {
      return {
        status: 'LIKELY',
        explanation: 'Likely to fit based on available evidence. Confirm engine or trim if your vehicle has uncommon options.',
        evidence,
        missingAttributes: [],
        conflicts: [],
        vehicleConfigId,
      };
    }

    if (fitment.evidenceLevel === 'D' || fitment.evidenceLevel === 'E') {
      return {
        status: 'OEM_NUMBER_MATCH',
        explanation: fitment.reason || 'Compatibility is seller-declared or inferred and is not independently verified.',
        evidence,
        missingAttributes: [],
        conflicts: [],
        vehicleConfigId,
      };
    }

    return {
      status: 'NOT_VERIFIED',
      explanation: fitment.reason || 'Fitment has not been verified for this vehicle configuration.',
      evidence,
      missingAttributes: [],
      conflicts: [],
      vehicleConfigId,
    };
  }
}
