import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  modelLookupVariants,
  normalizeMvlToken,
} from '../ingestion/mvl-match.util';
import {
  dedupeCatalogRows,
  extractChassisPlatform,
  parseSeedYear,
  partHasOeNumber,
  shouldExpandOeCatalog,
  summarizeCompatibleVehicles,
  type MvlCatalogRow,
  type MvlCatalogSeed,
} from './mvl-oe-catalog.util';

/**
 * Buyer catalog is US eBay / US marketplace listings. Display rows always come
 * from US MVL (US trim/engine naming). DE/UK are only used as a chassis-code
 * oracle when US rows lack partsModel/region platform codes.
 */
const DISPLAY_MARKET = 'US' as const;
const PLATFORM_ORACLE_MARKETS = ['DE', 'UK', 'AU'] as const;
const ROW_CAP = 400;

type SeedHit = {
  year: number;
  make: string;
  model: string;
  trim: string | null;
  engine: string | null;
  epid: string | null;
  market: string;
  partsModel: string | null;
  region: string | null;
};

export type OeCatalogEnrichmentResult = {
  rows: MvlCatalogRow[];
  compatibleVehicles: ReturnType<typeof summarizeCompatibleVehicles>;
  platform: string | null;
  expanded: boolean;
};

/**
 * Expand sparse OE-part fitment (often a single donor YMM) into a full
 * generation catalog using MVL chassis/platform codes (e.g. Jaguar XF X260),
 * then render US-market trim/engine rows for that year span.
 * Live on PDP only — does not persist.
 */
@Injectable()
export class MvlOeCatalogService {
  private readonly logger = new Logger(MvlOeCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enrichForPart(input: {
    oeNumbers?: string[] | null;
    genuineOemPartNumber?: string | null;
    manufacturerPartNumber?: string | null;
    partSource?: string | null;
    seeds: Array<{
      year?: number | string | null;
      make?: string | null;
      model?: string | null;
      trim?: string | null;
      engine?: string | null;
    }>;
    existingRows: Array<{
      year?: number | string;
      make?: string;
      model?: string;
    }>;
  }): Promise<OeCatalogEnrichmentResult | null> {
    if (
      !partHasOeNumber({
        oeNumbers: input.oeNumbers,
        genuineOemPartNumber: input.genuineOemPartNumber,
        manufacturerPartNumber: input.manufacturerPartNumber,
        partSource: input.partSource,
      })
    ) {
      return null;
    }

    if (!shouldExpandOeCatalog(input.existingRows)) {
      return null;
    }

    const seeds = this.normalizeSeeds(input.seeds);
    if (seeds.length === 0) return null;

    const expanded: MvlCatalogRow[] = [];
    let platformUsed: string | null = null;

    // One expansion per unique make+model (anchor on first seed year).
    const seenMakeModel = new Set<string>();
    for (const seed of seeds) {
      const mmKey = `${normalizeMvlToken(seed.make)}|${normalizeMvlToken(seed.model)}`;
      if (seenMakeModel.has(mmKey)) continue;
      seenMakeModel.add(mmKey);

      const usHit = await this.findSeedHit(seed, [DISPLAY_MARKET]);
      if (!usHit) continue;

      // US ePID rows rarely carry chassis codes — resolve platform + year
      // span from DE/UK when needed, then expand US rows in that span.
      let platform = extractChassisPlatform(
        usHit.partsModel,
        usHit.region,
        usHit.model,
      );
      let yearFrom: number | null = null;
      let yearTo: number | null = null;

      if (!platform) {
        const oracle = await this.resolvePlatformYearSpan(seed);
        if (oracle) {
          platform = oracle.platform;
          yearFrom = oracle.yearFrom;
          yearTo = oracle.yearTo;
        }
      } else {
        const span = await this.platformYearSpan({
          seedMake: seed.make,
          seedModel: seed.model,
          platform,
          markets: [...PLATFORM_ORACLE_MARKETS, DISPLAY_MARKET],
        });
        yearFrom = span?.yearFrom ?? null;
        yearTo = span?.yearTo ?? null;
      }

      const rows =
        platform && yearFrom != null && yearTo != null
          ? await this.expandUsYearRange({
              seedMake: seed.make,
              seedModel: seed.model,
              yearFrom,
              yearTo,
              platform,
            })
          : await this.expandSeedYearTrims(usHit);

      if (platform) platformUsed = platform;
      expanded.push(...rows);
      if (expanded.length >= ROW_CAP) break;
    }

    const rows = dedupeCatalogRows(expanded).slice(0, ROW_CAP);
    if (rows.length === 0) return null;

    const existingYears = new Set(
      input.existingRows
        .map((r) => parseSeedYear(r.year ?? null))
        .filter((y): y is number => y != null),
    );
    if (
      rows.length <= input.existingRows.length &&
      new Set(rows.map((r) => r.year)).size <= existingYears.size
    ) {
      return null;
    }

    this.logger.debug(
      `OE catalog enrich (US): ${rows.length} rows` +
        (platformUsed ? ` platform=${platformUsed}` : ' (year-trim fallback)'),
    );

    return {
      rows,
      compatibleVehicles: summarizeCompatibleVehicles(rows),
      platform: platformUsed,
      expanded: true,
    };
  }

  private normalizeSeeds(
    raw: Array<{
      year?: number | string | null;
      make?: string | null;
      model?: string | null;
      trim?: string | null;
      engine?: string | null;
    }>,
  ): MvlCatalogSeed[] {
    const out: MvlCatalogSeed[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      const year = parseSeedYear(row.year ?? null);
      const make = String(row.make || '').trim();
      const model = String(row.model || '').trim();
      if (!year || !make || !model || make === '-' || model === '-') continue;
      const key = `${year}|${normalizeMvlToken(make)}|${normalizeMvlToken(model)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        year,
        make,
        model,
        trim: row.trim,
        engine: row.engine,
      });
    }
    return out;
  }

  private async findSeedHit(
    seed: MvlCatalogSeed,
    markets: readonly string[],
  ): Promise<SeedHit | null> {
    const nMake = normalizeMvlToken(seed.make);
    const variants = modelLookupVariants(seed.model)
      .map((v) => normalizeMvlToken(v))
      .filter(Boolean);
    if (!nMake || variants.length === 0) return null;

    const hits = await this.prisma.mvlVehicle.findMany({
      where: {
        year: seed.year,
        normalizedMake: nMake,
        normalizedModel: { in: variants },
        market: { in: [...markets] },
      },
      select: {
        year: true,
        make: true,
        model: true,
        trim: true,
        engine: true,
        epid: true,
        market: true,
        partsModel: true,
        region: true,
      },
      take: 80,
    });
    if (hits.length === 0) return null;

    const marketRank = new Map(markets.map((m, i) => [m, i]));
    const seedTrim = normalizeMvlToken(seed.trim || '');
    const seedEngine = normalizeMvlToken(seed.engine || '');

    const scored = hits
      .map((h) => {
        let score = 100 - (marketRank.get(h.market) ?? 50);
        if (seedTrim && normalizeMvlToken(h.trim || '') === seedTrim) {
          score += 50;
        }
        if (
          seedTrim &&
          h.trim &&
          normalizeMvlToken(h.trim).includes(seedTrim)
        ) {
          score += 20;
        }
        if (
          seedEngine &&
          normalizeMvlToken(h.engine || '').includes(seedEngine.slice(0, 6))
        ) {
          score += 10;
        }
        if (extractChassisPlatform(h.partsModel, h.region, h.model)) {
          score += 15;
        }
        return { h, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.h ?? null;
  }

  /** Resolve chassis code + year span from DE/UK for a US seed YMM. */
  private async resolvePlatformYearSpan(seed: MvlCatalogSeed): Promise<{
    platform: string;
    yearFrom: number;
    yearTo: number;
  } | null> {
    const oracleHit = await this.findSeedHit(seed, PLATFORM_ORACLE_MARKETS);
    if (!oracleHit) return null;
    const platform = extractChassisPlatform(
      oracleHit.partsModel,
      oracleHit.region,
      oracleHit.model,
    );
    if (!platform) return null;
    return this.platformYearSpan({
      seedMake: seed.make,
      seedModel: seed.model,
      platform,
      markets: [...PLATFORM_ORACLE_MARKETS],
    });
  }

  private async platformYearSpan(input: {
    seedMake: string;
    seedModel: string;
    platform: string;
    markets: string[];
  }): Promise<{ platform: string; yearFrom: number; yearTo: number } | null> {
    const nMake = normalizeMvlToken(input.seedMake);
    const variants = modelLookupVariants(input.seedModel)
      .map((v) => normalizeMvlToken(v))
      .filter(Boolean);
    if (!nMake || variants.length === 0) return null;

    const hits = await this.prisma.mvlVehicle.findMany({
      where: {
        normalizedMake: nMake,
        normalizedModel: { in: variants },
        market: { in: input.markets },
        OR: [
          { partsModel: input.platform },
          { partsModel: { contains: input.platform, mode: 'insensitive' } },
          { region: { contains: input.platform, mode: 'insensitive' } },
        ],
      },
      select: { year: true },
      distinct: ['year'],
      orderBy: { year: 'asc' },
      take: 80,
    });
    if (hits.length === 0) return null;
    const years = hits.map((h) => h.year);
    return {
      platform: input.platform,
      yearFrom: Math.min(...years),
      yearTo: Math.max(...years),
    };
  }

  /** US MVL rows for make+model across the platform year span. */
  private async expandUsYearRange(input: {
    seedMake: string;
    seedModel: string;
    yearFrom: number;
    yearTo: number;
    platform: string;
  }): Promise<MvlCatalogRow[]> {
    const nMake = normalizeMvlToken(input.seedMake);
    const variants = modelLookupVariants(input.seedModel)
      .map((v) => normalizeMvlToken(v))
      .filter(Boolean);
    if (!nMake || variants.length === 0) return [];

    const hits = await this.prisma.mvlVehicle.findMany({
      where: {
        market: DISPLAY_MARKET,
        normalizedMake: nMake,
        normalizedModel: { in: variants },
        year: { gte: input.yearFrom, lte: input.yearTo },
      },
      select: {
        year: true,
        make: true,
        model: true,
        trim: true,
        engine: true,
        epid: true,
        market: true,
      },
      take: ROW_CAP * 2,
    });

    return this.mapUsRows(hits, input.platform);
  }

  /** No chassis code — expand all US trims/engines for the seed year. */
  private async expandSeedYearTrims(hit: SeedHit): Promise<MvlCatalogRow[]> {
    const nMake = normalizeMvlToken(hit.make);
    const variants = modelLookupVariants(hit.model)
      .map((v) => normalizeMvlToken(v))
      .filter(Boolean);
    if (!nMake || variants.length === 0) return [];

    const hits = await this.prisma.mvlVehicle.findMany({
      where: {
        market: DISPLAY_MARKET,
        year: hit.year,
        normalizedMake: nMake,
        normalizedModel: { in: variants },
      },
      select: {
        year: true,
        make: true,
        model: true,
        trim: true,
        engine: true,
        epid: true,
        market: true,
      },
      take: ROW_CAP,
    });

    return this.mapUsRows(hits, null);
  }

  private mapUsRows(
    hits: Array<{
      year: number;
      make: string;
      model: string;
      trim: string | null;
      engine: string | null;
      epid: string | null;
      market: string;
    }>,
    platform: string | null,
  ): MvlCatalogRow[] {
    const best = new Map<string, (typeof hits)[number]>();
    for (const hit of hits) {
      const key = [
        hit.year,
        normalizeMvlToken(hit.make),
        normalizeMvlToken(hit.model),
        normalizeMvlToken(hit.trim || '-'),
        normalizeMvlToken(hit.engine || '-'),
      ].join('|');
      if (!best.has(key)) best.set(key, hit);
    }

    return [...best.values()].map((h) => ({
      year: h.year,
      make: h.make,
      model: h.model,
      trim: h.trim || '-',
      engine: h.engine || '-',
      source: 'mvl_catalog' as const,
      mvlVerified: true as const,
      epid: h.epid,
      platform,
    }));
  }
}
