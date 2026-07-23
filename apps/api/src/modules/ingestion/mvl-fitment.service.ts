import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  expandYears,
  modelLookupVariants,
  normalizeMvlToken,
  type MvlYmmCandidate,
} from './mvl-match.util';

export type VerifiedCompatRow = {
  year: number;
  make: string;
  model: string;
  trim: string;
  engine: string;
  source: string;
  epid?: string;
  verified: true;
};

@Injectable()
export class MvlFitmentService {
  private readonly logger = new Logger(MvlFitmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async hasMvlData(): Promise<boolean> {
    const hit = await this.prisma.mvlVehicle.findFirst({ select: { id: true } });
    return Boolean(hit);
  }

  /** True when at least one MVL row exists for year+make+model (model variants tried). */
  async ymmExists(year: number, make: string, model: string): Promise<{
    exists: boolean;
    make: string;
    model: string;
    epid: string | null;
    trim: string | null;
    engine: string | null;
    market: string | null;
  }> {
    const nMake = normalizeMvlToken(make);
    for (const variant of modelLookupVariants(model)) {
      const nModel = normalizeMvlToken(variant);
      if (!nMake || !nModel) continue;
      // Prefer DE/UK for European catalogs, then AU, then US (explicit priority).
      for (const market of ['DE', 'UK', 'AU', 'US'] as const) {
        const hit = await this.prisma.mvlVehicle.findFirst({
          where: { year, normalizedMake: nMake, normalizedModel: nModel, market },
          select: {
            make: true,
            model: true,
            epid: true,
            trim: true,
            engine: true,
            market: true,
          },
        });
        if (hit) {
          return {
            exists: true,
            make: hit.make,
            model: hit.model,
            epid: hit.epid,
            trim: hit.trim,
            engine: hit.engine,
            market: hit.market,
          };
        }
      }
    }
    return { exists: false, make, model, epid: null, trim: null, engine: null, market: null };
  }

  /**
   * Filter candidate YMM rows to those present in US MVL.
   * Returns verified compatibility rows + vehicle configs for Fitment upserts.
   */
  async verifyCandidates(candidates: MvlYmmCandidate[]): Promise<{
    rows: VerifiedCompatRow[];
    configs: Array<{
      vehicleConfigId: string;
      year: number;
      make: string;
      model: string;
      epid: string | null;
    }>;
  }> {
    const rows: VerifiedCompatRow[] = [];
    const configs: Array<{
      vehicleConfigId: string;
      year: number;
      make: string;
      model: string;
      epid: string | null;
    }> = [];
    const seenYmm = new Set<string>();
    const seenConfig = new Set<string>();

    for (const c of candidates) {
      if (!c?.year || !c.make || !c.model) continue;
      const key = `${c.year}|${normalizeMvlToken(c.make)}|${normalizeMvlToken(c.model)}`;
      if (seenYmm.has(key)) continue;

      const match = await this.ymmExists(c.year, c.make, c.model);
      if (!match.exists) continue;
      seenYmm.add(key);

      rows.push({
        year: c.year,
        make: match.make,
        model: match.model,
        trim: c.trim || match.trim || '-',
        engine: c.engine || match.engine || '-',
        source: c.source || 'mvl',
        epid: match.epid || undefined,
        verified: true,
      });

      const config = await this.findOrCreateYmmConfig({
        year: c.year,
        make: match.make,
        model: match.model,
        trim: c.trim || match.trim,
        engine: c.engine || match.engine,
        epid: match.epid,
        market: match.market || 'US',
      });
      if (!seenConfig.has(config.id)) {
        seenConfig.add(config.id);
        configs.push({
          vehicleConfigId: config.id,
          year: c.year,
          make: match.make,
          model: match.model,
          epid: match.epid,
        });
      }
    }

    return { rows, configs };
  }

  /** Expand a year-range vehicle and verify each year against MVL. */
  async verifyYearRange(input: {
    startYear: number;
    endYear: number;
    make: string;
    model: string;
    trim?: string | null;
    engine?: string | null;
    source?: string;
  }) {
    const candidates = expandYears(input.startYear, input.endYear).map((year) => ({
      year,
      make: input.make,
      model: input.model,
      trim: input.trim,
      engine: input.engine,
      source: input.source,
    }));
    return this.verifyCandidates(candidates);
  }

  async findOrCreateYmmConfig(input: {
    year: number;
    make: string;
    model: string;
    trim?: string | null;
    engine?: string | null;
    epid?: string | null;
    market?: string | null;
  }) {
    // YMM-level configs are shared; do not key them by ePID (trim-specific).
    void input.epid;
    const market = (input.market || 'US').toUpperCase();

    const make = await this.prisma.vehicleMake.upsert({
      where: { name: input.make },
      update: {},
      create: { name: input.make, canonicalName: input.make, displayName: input.make },
    });

    let model = await this.prisma.vehicleModel.findFirst({
      where: { makeId: make.id, name: input.model },
    });
    if (!model) {
      model = await this.prisma.vehicleModel.create({
        data: { makeId: make.id, name: input.model },
      });
    }

    let generation = await this.prisma.vehicleGeneration.findFirst({
      where: {
        modelId: model.id,
        startYear: input.year,
        endYear: input.year,
      },
    });
    if (!generation) {
      generation = await this.prisma.vehicleGeneration.create({
        data: {
          modelId: model.id,
          name: String(input.year),
          startYear: input.year,
          endYear: input.year,
        },
      });
    }

    let config = await this.prisma.vehicleConfiguration.findFirst({
      where: {
        generationId: generation.id,
        market,
      },
    });
    if (!config) {
      config = await this.prisma.vehicleConfiguration.create({
        data: {
          generationId: generation.id,
          trim: input.trim || null,
          engine: input.engine || null,
          market,
        },
      });
    }
    return config;
  }

  async upsertVerifiedFitments(input: {
    canonicalPartId: string;
    configs: Array<{ vehicleConfigId: string }>;
    source: string;
    reviewer: string;
  }) {
    const fitments: { vehicleConfigId: string; evidenceLevel: string; confidence: number }[] = [];
    for (const c of input.configs) {
      const fitment = await this.prisma.fitment.upsert({
        where: {
          canonicalPartId_vehicleConfigId: {
            canonicalPartId: input.canonicalPartId,
            vehicleConfigId: c.vehicleConfigId,
          },
        },
        update: {
          evidenceLevel: 'B',
          confidence: 0.9,
          reviewer: input.reviewer,
          source: input.source,
          verificationStatus: 'VERIFIED',
          reason: 'Matched US MVL Year/Make/Model',
        },
        create: {
          canonicalPartId: input.canonicalPartId,
          vehicleConfigId: c.vehicleConfigId,
          evidenceLevel: 'B',
          confidence: 0.9,
          reviewer: input.reviewer,
          source: input.source,
          verificationStatus: 'VERIFIED',
          reason: 'Matched US MVL Year/Make/Model',
        },
      });

      await this.prisma.fitmentEvidence.create({
        data: {
          fitmentId: fitment.id,
          evidenceType: input.source,
          evidenceLevel: 'B',
          confidence: 0.9,
          source: input.source,
          verifiedBy: input.reviewer,
          verifiedAt: new Date(),
          reason: 'US MVL year/make/model match',
        },
      }).catch(() => undefined);

      fitments.push({
        vehicleConfigId: fitment.vehicleConfigId,
        evidenceLevel: 'B',
        confidence: 0.9,
      });
    }
    return fitments;
  }

  mergeCompatJson(
    existing: Prisma.JsonValue | null | undefined,
    verified: VerifiedCompatRow[],
  ): VerifiedCompatRow[] {
    const out: VerifiedCompatRow[] = [];
    const seen = new Set<string>();
    const push = (row: any) => {
      if (!row) return;
      const year = typeof row.year === 'number' ? row.year : parseInt(String(row.year), 10);
      if (!Number.isFinite(year) || !row.make || !row.model) return;
      const key = `${year}|${String(row.make).toLowerCase()}|${String(row.model).toLowerCase()}|${String(row.trim || '-').toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        year,
        make: String(row.make),
        model: String(row.model),
        trim: String(row.trim || '-'),
        engine: String(row.engine || '-'),
        source: String(row.source || 'mvl'),
        epid: row.epid,
        verified: true,
      });
    };
    if (Array.isArray(existing)) existing.forEach(push);
    verified.forEach(push);
    return out.sort((a, b) => a.year - b.year);
  }
}
