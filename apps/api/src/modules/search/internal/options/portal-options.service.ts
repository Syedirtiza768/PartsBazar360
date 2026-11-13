/**
 * "Every sellable option, precisely" — staff search for Omni Core's Parts
 * Search portal (internal, key-guarded).
 *
 *   number query → candidates by number from the index *and* Postgres (the
 *                  index drifts), expanded through cross-references
 *                  (see number-graph.ts), grouped by relation with a trail.
 *   text query   → relevance-ranked candidates from the v1 search, grouped by
 *                  fitment verdict when a vehicle is known.
 *
 * Every shown part then gets, from Postgres at query time: live availability
 * (availability.ts) and, when a vehicle is known, a fitment verdict decided by
 * the kind of evidence (fitment-verdict.ts). Nothing here writes data.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../prisma.service';
import {
  normalizeMvlToken,
  modelLookupVariants,
} from '../../../ingestion/mvl-match.util';
import {
  SEARCH_ALIAS,
  SEARCH_INDEX_VERSION,
  physicalIndexName,
} from '../../index/search-index.schema';
import {
  normalizePartNumber,
  partNumberVariants,
} from '../../query/part-number.util';
import { parseQuery, type ParsedQuery } from '../../query/query-parser';
import { SearchV1Service } from '../../v1/search-v1.service';
import type { SearchQueryDto } from '../../v1/search-query.dto';
import {
  OFFER_SELECT,
  toInternalOffers,
  type InternalOffer,
  type OfferRow,
} from '../internal-search.service';
import {
  AVAILABILITY_ORDER,
  conditionRank,
  summarizeAvailability,
  type AvailabilitySummary,
} from './availability';
import {
  VERDICT_ORDER,
  decideVerdict,
  parseEngineLitres,
  summarizeDocumented,
  type EvidenceRow,
  type ResolvedVehicle,
  type VerdictResult,
} from './fitment-verdict';
import {
  RELATION_ORDER,
  classifyDirect,
  describeRef,
  editDistance,
  expansionNumbers,
  isGenuinePart,
  itemSpecificGenuine,
  itemSpecificNumbers,
  makeFamilies,
  isSignificantNumber,
  numbersOfPart,
  sourceLabel,
  strongestRef,
  type CatalogNumberRow,
  type NumberedPart,
  type PartNumberRef,
  type Relation,
  type TrailStep,
} from './number-graph';
import type { Droppable, OptionsQueryDto } from './options-query.dto';

/** Hard caps keep a pathological number (e.g. a shared bolt OE number) bounded. */
const MAX_DIRECT = 300;
const MAX_TOTAL = 500;
const MAX_EXPANSION_NUMBERS = 80;
const MAX_PER_GROUP = 200;
const MAX_SUPERSEDED_DEPTH = 10;

export type GroupKey =
  | Relation
  | 'matches'
  | 'related'
  | 'fits'
  | 'likely'
  | 'universal'
  | 'unverified'
  | 'does_not_fit';

export const GROUP_LABELS: Record<GroupKey, string> = {
  exact: 'Exact number',
  superseded: 'Replaces / replaced by',
  oem_equivalent: 'OEM equivalent',
  aftermarket_equivalent: 'Aftermarket equivalent',
  possible: 'Possible equivalent (unverified cross-reference)',
  matches: 'Matches',
  related: 'Other matches (not the part asked for)',
  fits: 'Fits your vehicle',
  likely: 'Likely fits',
  universal: 'Universal',
  unverified: 'Not confirmed for your vehicle',
  does_not_fit: 'Does not fit',
};

export interface OptionItem {
  partId: string;
  title: string;
  brand: string | null;
  partSource: string | null;
  qualityTier: string | null;
  category: string | null;
  partType: string | null;
  position: string | null;
  manufacturerPartNumber: string | null;
  image: string | null;
  imageCount: number;
  slug: string | null;
  publicUrl: string;
  /** Normalized significant numbers on the part (Omni Core stock matching). */
  numbers: string[];
  match: {
    relation: Relation | 'text';
    label: string;
    matchedNumber: string | null;
    trail: TrailStep[];
    note: string | null;
    /** Text queries: the title names the part asked for (or a synonym). */
    asked: boolean;
  };
  fitment:
    | (VerdictResult & { documented: string | null })
    | { verdict: null; reason: null; evidence: []; documented: string | null };
  availability: AvailabilitySummary;
  offers: InternalOffer[];
  relevanceRank: number;
}

export interface OptionGroup {
  key: GroupKey;
  label: string;
  total: number;
  /** Not-available items hidden from `items` unless includeUnavailable. */
  hiddenUnavailable: number;
  collapsedByDefault: boolean;
  items: OptionItem[];
}

export interface OptionsResponse {
  requestId: string;
  mode: 'number' | 'text' | 'empty';
  query: {
    original: string;
    effective: string;
    numbers: string[];
    interpreted: Array<{
      key: Droppable | 'engine';
      label: string;
      value: string;
    }>;
    dropped: Droppable[];
  };
  vehicle:
    | (Omit<ResolvedVehicle, 'configLitres' | 'configIds'> & {
        source: 'selected' | 'query';
        configCount: number;
        engines: number[];
      })
    | null;
  summary: {
    totalOptions: number;
    inStock: number;
    inStockFits: number;
    likely: number;
    canSource: number;
    notAvailable: number;
    possibleEquivalents: number;
    excludedOtherMake: number;
    sentence: string;
  };
  groups: OptionGroup[];
  didYouMean: Array<{ number: string; parts: number }>;
  facets?: Record<string, Array<{ value: string; count: number }>>;
  pagination?: {
    page: number;
    pageSize: number;
    totalResults: number;
    totalPages: number;
  };
  corrections: Array<{ type: string; message: string }>;
  meta: {
    tookMs: number;
    checkedAt: string;
    audience: 'internal';
    index: string;
  };
}

type PartRow = NumberedPart & {
  title: string;
  qualityTier: string | null;
  category: string | null;
  partType: string | null;
  position: string | null;
  imageUrls: string[];
  slug: string | null;
};

interface Candidate {
  part: PartRow;
  relation: Relation | 'text';
  matched: PartNumberRef | null;
  trail: TrailStep[];
  note: string | null;
  relevanceRank: number;
}

const PART_SELECT = {
  id: true,
  title: true,
  brand: true,
  partSource: true,
  qualityTier: true,
  category: true,
  partType: true,
  position: true,
  manufacturerPartNumber: true,
  oeNumbers: true,
  itemSpecifics: true,
  imageUrls: true,
  slug: true,
  partNumbers: {
    select: {
      displayNumber: true,
      normalizedNumber: true,
      numberType: true,
      source: true,
      verificationStatus: true,
      confidence: true,
    },
  },
} as const;

function partLabel(part: PartRow): string {
  return (
    [part.brand, part.manufacturerPartNumber].filter(Boolean).join(' ') ||
    part.title.slice(0, 60)
  );
}

function relationOf(part: PartRow): Relation {
  return isGenuinePart(part) ? 'oem_equivalent' : 'aftermarket_equivalent';
}

function normalizeBrand(value: string | null | undefined): string {
  return normalizeMvlToken(value ?? '');
}

@Injectable()
export class PortalOptionsService {
  private readonly logger = new Logger(PortalOptionsService.name);
  private readonly client: Client;
  private makeCache: { at: number; makes: Map<string, string> } | null = null;
  /** When the pb_part_numbers() lookup last failed (0 = never). */
  private partNumbersLookupFailedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly searchV1: SearchV1Service,
  ) {
    this.client = new Client({
      node: process.env.OPENSEARCH_URL || 'http://opensearch:9200',
      requestTimeout: Number(process.env.SEARCH_TIMEOUT_MS || 5000),
    });
  }

  // ---------------------------------------------------------------- entry

  async options(dto: OptionsQueryDto): Promise<OptionsResponse> {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const dropped = new Set<Droppable>(dto.drop ?? []);
    const original = dto.q ?? '';
    const parsed = parseQuery(original);
    if (dropped.has('number')) parsed.partNumbers = [];
    if (dropped.has('make')) parsed.make = undefined;
    if (dropped.has('model')) parsed.model = undefined;
    if (dropped.has('year')) {
      parsed.year = undefined;
      parsed.yearRange = undefined;
    }
    if (dropped.has('side')) parsed.side = undefined;
    if (dropped.has('position')) parsed.positions = [];

    const index = await this.resolveIndex();
    const { vehicle, vehicleSource } = await this.resolveVehicleFromInput(
      dto,
      parsed,
    );
    const numbers = [
      ...new Set(parsed.partNumbers.map(normalizePartNumber)),
    ].filter((n) => n.length >= 3);

    let mode: OptionsResponse['mode'] = 'empty';
    let candidates: Candidate[] = [];
    let didYouMean: OptionsResponse['didYouMean'] = [];
    let excludedOtherMake = 0;
    let facets: OptionsResponse['facets'];
    let pagination: OptionsResponse['pagination'];
    const corrections: OptionsResponse['corrections'] = [];
    let effective = original;

    if (numbers.length) {
      mode = 'number';
      const result = await this.numberCandidates(
        numbers,
        original,
        parsed,
        vehicle,
        index,
      );
      candidates = result.candidates;
      excludedOtherMake = result.excludedOtherMake;
      if (result.partial) {
        corrections.push({
          type: 'partial',
          message: `No part carries exactly “${numbers.join(', ')}” — showing parts whose number starts with it.`,
        });
      }
      if (!candidates.length)
        didYouMean = await this.didYouMean(numbers[0], index);
    } else if (original.trim() || vehicle) {
      mode = 'text';
      effective = this.effectiveText(original, parsed, dropped);
      const text = await this.textCandidates(
        effective,
        dto,
        vehicle,
        vehicleSource,
      );
      candidates = text.candidates;
      facets = text.facets;
      pagination = text.pagination;
      corrections.push(...text.corrections);
    }

    const items = await this.enrich(candidates, vehicle, parsed);
    const groups = this.group(
      items,
      mode,
      Boolean(vehicle),
      dto.includeUnavailable === true,
    );
    const summary = this.summarize(items, vehicle, excludedOtherMake);

    return {
      requestId,
      mode,
      query: {
        original,
        effective,
        numbers,
        interpreted: this.interpretation(parsed, vehicle, vehicleSource),
        dropped: [...dropped],
      },
      vehicle: vehicle
        ? {
            label: vehicle.label,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            engineLitres: vehicle.engineLitres,
            exactConfigId: vehicle.exactConfigId,
            source: vehicleSource,
            configCount: vehicle.configIds.length,
            engines: [
              ...new Set(
                Object.values(vehicle.configLitres).filter(
                  (v): v is number => v != null,
                ),
              ),
            ].sort(),
          }
        : null,
      summary,
      groups,
      didYouMean,
      facets,
      pagination,
      corrections,
      meta: {
        tookMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        audience: 'internal',
        index,
      },
    };
  }

  // ------------------------------------------------------------- vehicle

  private async resolveVehicleFromInput(
    dto: OptionsQueryDto,
    parsed: ParsedQuery,
  ): Promise<{
    vehicle: ResolvedVehicle | null;
    vehicleSource: 'selected' | 'query';
  }> {
    if (dto.vehicleConfigId || dto.makeId || dto.make) {
      return {
        vehicle: await this.resolveVehicle({
          configId: dto.vehicleConfigId,
          makeId: dto.makeId,
          modelId: dto.modelId,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          engineLitres: dto.engineLitres,
        }),
        vehicleSource: 'selected',
      };
    }
    if (parsed.make && parsed.model && parsed.year) {
      return {
        vehicle: await this.resolveVehicle({
          make: parsed.make,
          model: parsed.model,
          year: parsed.year,
          engineLitres: parsed.engineLitres,
        }),
        vehicleSource: 'query',
      };
    }
    return { vehicle: null, vehicleSource: 'query' };
  }

  async resolveVehicle(input: {
    configId?: string;
    makeId?: string;
    modelId?: string;
    make?: string;
    model?: string;
    year?: number;
    engineLitres?: number;
  }): Promise<ResolvedVehicle | null> {
    let makeId = input.makeId;
    let modelIds: string[] = input.modelId ? [input.modelId] : [];
    let year = input.year;
    let exactConfigId: string | undefined;
    let engineLitres = input.engineLitres;

    if (input.configId) {
      const config = await this.prisma.vehicleConfiguration.findUnique({
        where: { id: input.configId },
        select: {
          id: true,
          engine: true,
          trim: true,
          generation: {
            select: {
              startYear: true,
              endYear: true,
              modelId: true,
              model: { select: { makeId: true } },
            },
          },
        },
      });
      if (!config) return null;
      exactConfigId = config.id;
      makeId = config.generation.model.makeId;
      modelIds = [config.generation.modelId];
      year = year ?? config.generation.startYear ?? undefined;
      engineLitres =
        engineLitres ??
        parseEngineLitres(config.engine ?? config.trim) ??
        undefined;
    }

    if (!makeId && input.make) {
      const normalized = normalizeMvlToken(input.make);
      const makes = await this.prisma.vehicleMake.findMany({
        select: { id: true, name: true, canonicalName: true },
      });
      makeId = makes.find(
        (m) =>
          normalizeMvlToken(m.name) === normalized ||
          normalizeMvlToken(m.canonicalName) === normalized,
      )?.id;
      if (!makeId) {
        const alias = await this.prisma.vehicleMakeAlias
          .findUnique({
            where: { normalized },
            select: { vehicleMakeId: true },
          })
          .catch(() => null);
        makeId = alias?.vehicleMakeId;
      }
    }
    if (!makeId || !year) return null;

    const make = await this.prisma.vehicleMake.findUnique({
      where: { id: makeId },
      select: { name: true, displayName: true },
    });
    if (!modelIds.length && input.model) {
      const variants = modelLookupVariants(input.model).map(normalizeMvlToken);
      const models = await this.prisma.vehicleModel.findMany({
        where: { makeId },
        select: { id: true, name: true },
      });
      for (const variant of variants) {
        const hits = models.filter(
          (m) => normalizeMvlToken(m.name) === variant,
        );
        if (hits.length) {
          modelIds = hits.map((m) => m.id);
          break;
        }
      }
    }
    if (!modelIds.length) return null;
    const models = await this.prisma.vehicleModel.findMany({
      where: { id: { in: modelIds } },
      select: { name: true },
    });

    const configs = await this.prisma.vehicleConfiguration.findMany({
      where: {
        generation: {
          modelId: { in: modelIds },
          AND: [
            { OR: [{ startYear: null }, { startYear: { lte: year } }] },
            { OR: [{ endYear: null }, { endYear: { gte: year } }] },
          ],
        },
      },
      select: { id: true, engine: true, trim: true },
      take: 2000,
    });
    const configLitres: Record<string, number | null> = {};
    for (const config of configs)
      configLitres[config.id] =
        parseEngineLitres(config.engine) ?? parseEngineLitres(config.trim);
    if (exactConfigId && !(exactConfigId in configLitres))
      configLitres[exactConfigId] = engineLitres ?? null;

    const makeName = make?.displayName || make?.name || input.make || '';
    const modelName = models[0]?.name || input.model || '';
    return {
      label: `${year} ${makeName} ${modelName}`.trim(),
      make: makeName,
      model: modelName,
      year,
      engineLitres: engineLitres ?? undefined,
      exactConfigId,
      configIds: Object.keys(configLitres),
      configLitres,
    };
  }

  // ------------------------------------------------------ number search

  private async numberCandidates(
    numbers: string[],
    original: string,
    parsed: ParsedQuery,
    vehicle: ResolvedVehicle | null,
    index: string,
  ): Promise<{
    candidates: Candidate[];
    excludedOtherMake: number;
    partial: boolean;
  }> {
    const query = new Set(numbers);
    let partial = false;
    let directIds = await this.idsByNumbers(
      numbers,
      this.rawVariants(original, numbers),
      index,
    );
    let direct = await this.loadParts(directIds.slice(0, MAX_DIRECT));
    let directMatches = direct
      .map((part) => ({ part, match: classifyDirect(part, query) }))
      .filter((row) => row.match);

    if (!directMatches.length) {
      // Partial number ("86401"): only for significant prefixes.
      const prefixes = numbers.filter(isSignificantNumber);
      if (prefixes.length) {
        directIds = await this.idsByPrefix(prefixes, index);
        direct = await this.loadParts(directIds.slice(0, MAX_DIRECT));
        directMatches = direct
          .map((part) => {
            const ref = numbersOfPart(part).find((r) =>
              prefixes.some((p) => r.number.startsWith(p)),
            );
            if (!ref) return { part, match: null };
            const exact = ['MPN', 'BRAND_MPN', 'OEM'].includes(ref.role);
            return {
              part,
              match: {
                relation: (exact ? 'exact' : relationOf(part)) as Relation,
                matched: ref,
              },
            };
          })
          .filter((row) => row.match);
        partial = directMatches.length > 0;
      }
    }

    const makes = await this.vehicleMakes();
    const compat = await this.compatSummaries(
      directMatches.map((row) => row.part.id),
    );
    // Context = manufacturer families (GM, VAG, Toyota/Lexus, …) of the query
    // or vehicle make, else of the clear majority of exact matches. Makes in
    // one family legitimately share numbers; other families do not.
    const explicitMake = normalizeMvlToken(vehicle?.make ?? parsed.make ?? '');
    const contextFamilies = new Set<string>(
      explicitMake
        ? makeFamilies(explicitMake)
        : this.dominantFamilies(
            directMatches
              .filter((row) => row.match!.relation === 'exact')
              .map((row) => row.part),
            compat,
            makes,
          ),
    );

    const byId = new Map<string, Candidate>();
    let excludedOtherMake = 0;
    const partMakes = (part: PartRow): Set<string> => {
      const set = new Set<string>(
        (compat.get(part.id) ?? []).map((row) => normalizeMvlToken(row.make)),
      );
      const brand = normalizeBrand(part.brand);
      if (makes.has(brand)) set.add(brand);
      return set;
    };
    const conflictsWithMake = (part: PartRow): string | null => {
      if (!contextFamilies.size) return null;
      const set = partMakes(part);
      if (!set.size) return null;
      if (
        [...set].some((make) =>
          makeFamilies(make).some((f) => contextFamilies.has(f)),
        )
      )
        return null;
      return [...set]
        .map((m) => makes.get(m) ?? m)
        .slice(0, 2)
        .join(', ');
    };
    const makeUnknown = (part: PartRow) =>
      contextFamilies.size > 0 && partMakes(part).size === 0;

    let rank = 0;
    for (const { part, match } of directMatches) {
      const conflict = conflictsWithMake(part);
      let relation = match!.relation;
      let note: string | null = null;
      if (conflict) {
        if (relation !== 'exact') {
          excludedOtherMake++;
          continue;
        }
        relation = 'possible';
        note = `Same number, but recorded for ${conflict}`;
      } else if (relation !== 'exact' && makeUnknown(part)) {
        note =
          'Vehicle make not documented on this part — verify before selling';
      }
      const matched = match!.matched;
      const step: TrailStep = {
        number: matched.display,
        relation: describeRef(matched),
        partId: part.id,
        partLabel: partLabel(part),
        source: sourceLabel(matched),
        text: `${matched.display} ${describeRef(matched)} ${partLabel(part)}`,
      };
      byId.set(part.id, {
        part,
        relation,
        matched,
        trail: [step],
        note,
        relevanceRank: rank++,
      });
    }

    // Hop 1 through any significant number; further hops only through verified
    // references (verified superseded chains to any bounded depth). Seller-
    // declared superseded numbers (listing item specifics) are unverified: they
    // mean "superseded" one hop from an exact match, never as a chain.
    let frontier = [...byId.values()];
    const usedNumbers = new Set<string>(numbers);
    for (
      let depth = 1;
      depth <= MAX_SUPERSEDED_DEPTH && frontier.length && byId.size < MAX_TOTAL;
      depth++
    ) {
      const edges = new Map<string, { ref: PartNumberRef; from: Candidate }>();
      for (const candidate of frontier) {
        for (const ref of expansionNumbers(candidate.part, query)) {
          if (usedNumbers.has(ref.number)) continue;
          if (depth > 1 && !ref.verified) continue;
          if (ref.role === 'MPN' && candidate.relation === 'possible') continue;
          if (!edges.has(ref.number))
            edges.set(ref.number, { ref, from: candidate });
        }
      }
      if (!edges.size) break;
      const edgeNumbers = [...edges.keys()].slice(0, MAX_EXPANSION_NUMBERS);
      edgeNumbers.forEach((n) => usedNumbers.add(n));
      const rawStored = edgeNumbers.map((n) => edges.get(n)!.ref.display);
      const ids = (
        await this.idsByNumbers(edgeNumbers, rawStored, index)
      ).filter((id) => !byId.has(id));
      if (!ids.length) break;
      const parts = await this.loadParts(ids.slice(0, MAX_TOTAL - byId.size));
      const moreCompat = await this.compatSummaries(parts.map((p) => p.id));
      for (const [id, rows] of moreCompat) compat.set(id, rows);

      const next: Candidate[] = [];
      for (const part of parts) {
        const refs = numbersOfPart(part);
        const hit = strongestRef(refs, edges);
        if (!hit) continue;
        const { ref: edgeRef, from } = edges.get(hit.number)!;
        const trail: TrailStep[] = [
          ...from.trail,
          {
            number: edgeRef.display,
            relation: describeRef(hit),
            partId: part.id,
            partLabel: partLabel(part),
            source: sourceLabel(hit),
            text: `${partLabel(from.part)} also carries ${edgeRef.display} (${sourceLabel(edgeRef)}), which ${describeRef(hit)} ${partLabel(part)}`,
          },
        ];
        const sameProduct =
          ['MPN', 'BRAND_MPN'].includes(edgeRef.role) &&
          ['MPN', 'BRAND_MPN'].includes(hit.role) &&
          normalizeBrand(part.brand) &&
          normalizeBrand(part.brand) === normalizeBrand(from.part.brand);
        const supersededEdge =
          edgeRef.role === 'SUPERSEDED' || hit.role === 'SUPERSEDED';
        const trustedSuperseded =
          supersededEdge &&
          ((edgeRef.role === 'SUPERSEDED' && edgeRef.verified) ||
            (hit.role === 'SUPERSEDED' && hit.verified) ||
            (depth === 1 && from.relation === 'exact'));
        const verifiedEdge =
          (edgeRef.verified && hit.verified && edgeRef.role !== 'MPN') ||
          trustedSuperseded;
        let relation: Relation;
        let note: string | null = null;
        if (sameProduct) {
          relation =
            from.relation === 'possible'
              ? 'possible'
              : (from.relation as Relation);
          note =
            `Same ${part.brand} ${part.manufacturerPartNumber ?? ''} as another listing`.trim();
        } else if (trustedSuperseded) {
          relation = 'superseded';
        } else if (supersededEdge) {
          relation = 'possible';
          note = 'Reached through a seller-declared superseded number';
        } else if (verifiedEdge && from.relation !== 'possible') {
          relation = relationOf(part);
        } else {
          relation = 'possible';
          note = 'Reached through an unverified cross-reference';
        }
        if (relation !== 'exact' && conflictsWithMake(part)) {
          excludedOtherMake++;
          continue;
        }
        const candidate: Candidate = {
          part,
          relation,
          matched: hit,
          trail,
          note,
          relevanceRank: rank++,
        };
        byId.set(part.id, candidate);
        next.push(candidate);
      }
      frontier = next;
    }

    return { candidates: [...byId.values()], excludedOtherMake, partial };
  }

  private rawVariants(original: string, numbers: string[]): string[] {
    const tokens = new Set<string>();
    const text = original.trim();
    if (text) {
      tokens.add(text);
      tokens.add(text.toUpperCase());
    }
    for (const n of numbers)
      for (const v of partNumberVariants(n)) tokens.add(v);
    return [...tokens].slice(0, 20);
  }

  /** Part ids carrying any of the numbers — index ∪ Postgres (index drifts). */
  private async idsByNumbers(
    numbers: string[],
    rawStored: string[],
    index: string,
  ): Promise<string[]> {
    const normalized = [
      ...new Set(numbers.map(normalizePartNumber).filter((n) => n.length >= 3)),
    ];
    if (!normalized.length) return [];
    const [fromIndex, fromCatalog, fromParts] = await Promise.all([
      this.client
        .search({
          index,
          body: {
            size: MAX_DIRECT,
            _source: false,
            query: { terms: { searchNumbers: normalized } },
          } as any,
        })
        .then((res: any) =>
          (res.body?.hits?.hits ?? []).map((hit: any) => String(hit._id)),
        )
        .catch((error: any) => {
          this.logger.warn(`index number lookup failed: ${error?.message}`);
          return [] as string[];
        }),
      this.prisma.catalogPartNumber
        .findMany({
          where: { normalizedNumber: { in: normalized } },
          select: { canonicalPartId: true },
          take: MAX_DIRECT,
        })
        .then((rows) => rows.map((row) => row.canonicalPartId)),
      this.idsByPartNumbers(normalized, rawStored),
    ]);
    // Order: index hits first (relevance), then database-only recoveries.
    return [...new Set([...fromIndex, ...fromParts, ...fromCatalog])];
  }

  /**
   * Parts whose MPN, any oeNumbers entry (also inside "A, B" lists) or any
   * number-bearing item specific normalizes to one of the numbers. Uses the
   * pb_part_numbers() GIN index (migration 20261027120000); until it exists,
   * falls back to whole-value MPN / oeNumbers matching (re-checked every 10 min).
   */
  private async idsByPartNumbers(
    normalized: string[],
    rawStored: string[],
  ): Promise<string[]> {
    if (Date.now() - this.partNumbersLookupFailedAt > 10 * 60_000) {
      try {
        const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
          SELECT id FROM "CanonicalPart"
          WHERE pb_part_numbers("manufacturerPartNumber", "oeNumbers", "itemSpecifics") && ${normalized}::text[]
          LIMIT ${MAX_DIRECT}`,
        );
        return rows.map((row) => row.id);
      } catch (error: any) {
        this.partNumbersLookupFailedAt = Date.now();
        this.logger.warn(
          `pb_part_numbers() unavailable, using whole-value number lookup: ${error?.message}`,
        );
      }
    }
    const raw = [
      ...new Set(rawStored.flatMap((value) => [value, value.toUpperCase()])),
    ].filter(Boolean);
    const [fromMpn, fromOe] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "CanonicalPart"
        WHERE regexp_replace(upper(COALESCE("manufacturerPartNumber", ''::text)), '[^A-Z0-9]'::text, ''::text, 'g'::text) = ANY(${normalized}::text[])
        LIMIT ${MAX_DIRECT}`),
      raw.length
        ? this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM "CanonicalPart" WHERE "oeNumbers" && ${raw}::text[] LIMIT ${MAX_DIRECT}`)
        : Promise.resolve([] as Array<{ id: string }>),
    ]);
    return [...fromMpn, ...fromOe].map((row) => row.id);
  }

  private async idsByPrefix(
    prefixes: string[],
    index: string,
  ): Promise<string[]> {
    const [fromIndex, fromCatalog] = await Promise.all([
      this.client
        .search({
          index,
          body: {
            size: 100,
            _source: false,
            query: {
              bool: {
                should: prefixes.map((p) => ({ prefix: { searchNumbers: p } })),
                minimum_should_match: 1,
              },
            },
          } as any,
        })
        .then((res: any) =>
          (res.body?.hits?.hits ?? []).map((hit: any) => String(hit._id)),
        )
        .catch(() => [] as string[]),
      this.prisma.catalogPartNumber
        .findMany({
          where: {
            OR: prefixes.map((p) => ({ normalizedNumber: { startsWith: p } })),
          },
          select: { canonicalPartId: true },
          take: 100,
        })
        .then((rows) => rows.map((row) => row.canonicalPartId)),
    ]);
    return [...new Set([...fromIndex, ...fromCatalog])];
  }

  private async didYouMean(
    number: string,
    index: string,
  ): Promise<OptionsResponse['didYouMean']> {
    try {
      const res: any = await this.client.search({
        index,
        body: {
          size: 30,
          _source: ['searchNumbers'],
          query: {
            fuzzy: {
              searchNumbers: {
                value: number,
                fuzziness: 2,
                prefix_length: 2,
                max_expansions: 50,
              },
            },
          },
        } as any,
      });
      const counts = new Map<string, number>();
      for (const hit of res.body?.hits?.hits ?? []) {
        for (const candidate of hit._source?.searchNumbers ?? []) {
          if (candidate === number || editDistance(candidate, number, 2) > 2)
            continue;
          counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .sort(
          (a, b) =>
            editDistance(a[0], number) - editDistance(b[0], number) ||
            b[1] - a[1] ||
            a[0].localeCompare(b[0]),
        )
        .slice(0, 3)
        .map(([value, parts]) => ({ number: value, parts }));
    } catch {
      return [];
    }
  }

  /**
   * Manufacturer families of the exact matches, by vote per part. Only a clear
   * majority family defines the context; a tie means "unknown" (no exclusion).
   */
  private dominantFamilies(
    parts: PartRow[],
    compat: Map<string, CompatRow[]>,
    makes: Map<string, string>,
  ): string[] {
    const votes = new Map<string, number>();
    for (const part of parts) {
      const brand = normalizeBrand(part.brand);
      const partMakes = makes.has(brand)
        ? [brand]
        : (compat.get(part.id) ?? []).map((row) => normalizeMvlToken(row.make));
      const families = new Set<string>(partMakes.flatMap(makeFamilies));
      for (const family of families)
        votes.set(family, (votes.get(family) ?? 0) + 1);
    }
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1]))
      return [];
    return [sorted[0][0]];
  }

  // -------------------------------------------------------- text search

  private effectiveText(
    original: string,
    parsed: ParsedQuery,
    dropped: Set<Droppable>,
  ): string {
    let text = original;
    const strip = (pattern: RegExp) => {
      text = text.replace(pattern, ' ');
    };
    if (dropped.has('year'))
      strip(/\b(19|20)\d{2}(\s*[-–]\s*(19|20)?\d{2})?\b/g);
    if (dropped.has('side'))
      strip(/\b(left|right|lh|rh|driver|passenger|l\/h|r\/h)\b/gi);
    if (dropped.has('position'))
      strip(/\b(front|rear|upper|lower|inner|outer)\b/gi);
    const escape = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (dropped.has('make')) {
      const make = parseQuery(original).make;
      if (make) strip(new RegExp(`\\b${escape(make)}\\b`, 'gi'));
    }
    if (dropped.has('model')) {
      const model = parseQuery(original).model;
      if (model) strip(new RegExp(`\\b${escape(model)}\\b`, 'gi'));
    }
    if (dropped.has('number'))
      for (const token of original.split(/\s+/))
        if (normalizePartNumber(token).length >= 5 && /\d/.test(token))
          strip(new RegExp(escape(token), 'g'));
    return text.replace(/\s+/g, ' ').trim();
  }

  private async textCandidates(
    q: string,
    dto: OptionsQueryDto,
    vehicle: ResolvedVehicle | null,
    vehicleSource: 'selected' | 'query',
  ): Promise<{
    candidates: Candidate[];
    facets: OptionsResponse['facets'];
    pagination: OptionsResponse['pagination'];
    corrections: OptionsResponse['corrections'];
  }> {
    // A vehicle picked in the UI narrows the text search by its make; the
    // verdict (not the index) decides fitment.
    const searchDto = {
      q:
        [
          q,
          vehicleSource === 'selected' &&
          vehicle &&
          !new RegExp(`\\b${vehicle.make}\\b`, 'i').test(q)
            ? vehicle.make
            : '',
        ]
          .filter(Boolean)
          .join(' ')
          .trim() || undefined,
      page: dto.page ?? 1,
      pageSize: dto.pageSize ?? 48,
      sort: 'relevance',
    } as SearchQueryDto;
    const response = await this.searchV1.search(searchDto);
    const ids = response.results.map((result: any) => String(result.id));
    const parts = await this.loadParts(ids);
    const order = new Map(ids.map((id, i) => [id, i]));
    return {
      candidates: parts
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .map((part) => ({
          part,
          relation: 'text' as const,
          matched: null,
          trail: [],
          note: null,
          relevanceRank: order.get(part.id) ?? 0,
        })),
      facets: response.facets,
      pagination: {
        page: response.pagination.page,
        pageSize: response.pagination.pageSize,
        totalResults: response.pagination.totalResults,
        totalPages: response.pagination.totalPages,
      },
      corrections: response.corrections.filter((c) => c.type !== 'error'),
    };
  }

  // ---------------------------------------------------------- enrichment

  private async loadParts(ids: string[]): Promise<PartRow[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.canonicalPart.findMany({
      where: { id: { in: ids } },
      select: PART_SELECT,
    });
    return rows.map(({ itemSpecifics, ...row }) => ({
      ...row,
      oeNumbers: row.oeNumbers ?? [],
      imageUrls: (row.imageUrls ?? []).filter(
        (url) => url && !/\.svg(\?|$)/i.test(url),
      ),
      catalogNumbers: row.partNumbers as CatalogNumberRow[],
      specificNumbers: itemSpecificNumbers(itemSpecifics),
      genuineFlag: itemSpecificGenuine(itemSpecifics),
    })) as PartRow[];
  }

  private async vehicleMakes(): Promise<Map<string, string>> {
    if (this.makeCache && Date.now() - this.makeCache.at < 10 * 60_000)
      return this.makeCache.makes;
    const rows = await this.prisma.vehicleMake.findMany({
      select: { name: true, displayName: true },
    });
    const makes = new Map<string, string>();
    for (const row of rows)
      makes.set(normalizeMvlToken(row.name), row.displayName || row.name);
    this.makeCache = { at: Date.now(), makes };
    return makes;
  }

  /**
   * Vehicles each part is documented for, from both places fitment lives:
   * the `compatibility` list on the part (~200k parts) and structured
   * `Fitment` rows (1.6M rows on ~190k parts, many with no list). Both feed
   * the make context and the "Fits: …" summary; only list rows count as
   * "appears in the compatibility list" (Fitment rows for the vehicle are
   * already weighed as evidence by decideVerdict).
   */
  private async compatSummaries(
    ids: string[],
  ): Promise<Map<string, CompatRow[]>> {
    const map = new Map<string, CompatRow[]>();
    if (!ids.length) return map;
    type Row = {
      id: string;
      make: string;
      model: string;
      min_year: number;
      max_year: number;
    };
    const [listRows, fitmentRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT p.id, x->>'make' AS make, x->>'model' AS model,
               min((x->>'year')::int) AS min_year, max((x->>'year')::int) AS max_year
        FROM "CanonicalPart" p, jsonb_array_elements(CASE WHEN jsonb_typeof(p.compatibility) = 'array' THEN p.compatibility ELSE '[]'::jsonb END) x
        WHERE p.id = ANY(${ids}::text[])
          AND coalesce(x->>'make', '') <> '' AND coalesce(x->>'model', '') <> '' AND (x->>'year') ~ '^[0-9]{4}$'
        GROUP BY p.id, x->>'make', x->>'model'`),
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT f."canonicalPartId" AS id, coalesce(mk."displayName", mk.name) AS make, md.name AS model,
               min(g."startYear") AS min_year,
               max(coalesce(g."endYear", extract(year FROM now())::int)) AS max_year
        FROM "Fitment" f
        JOIN "VehicleConfiguration" c ON c.id = f."vehicleConfigId"
        JOIN "VehicleGeneration" g ON g.id = c."generationId"
        JOIN "VehicleModel" md ON md.id = g."modelId"
        JOIN "VehicleMake" mk ON mk.id = md."makeId"
        WHERE f."canonicalPartId" = ANY(${ids}::text[]) AND g."startYear" IS NOT NULL
        GROUP BY f."canonicalPartId", coalesce(mk."displayName", mk.name), md.name`),
    ]);
    const add = (row: Row, source: CompatRow['source']) => {
      const list = map.get(row.id) ?? [];
      list.push({
        make: row.make,
        model: row.model,
        minYear: Number(row.min_year),
        maxYear: Number(row.max_year),
        source,
      });
      map.set(row.id, list);
    };
    listRows.forEach((row) => add(row, 'list'));
    fitmentRows.forEach((row) => add(row, 'fitment'));
    return map;
  }

  private async enrich(
    candidates: Candidate[],
    vehicle: ResolvedVehicle | null,
    parsed: ParsedQuery,
  ): Promise<OptionItem[]> {
    if (!candidates.length) return [];
    const ids = candidates.map((c) => c.part.id);
    const [offerRows, compat, evidence, anyFitment] = await Promise.all([
      this.prisma.sellerOffer.findMany({
        where: { canonicalPartId: { in: ids } },
        select: OFFER_SELECT,
      }) as unknown as Promise<OfferRow[]>,
      this.compatSummaries(ids),
      vehicle && vehicle.configIds.length
        ? this.prisma.$queryRaw<
            Array<EvidenceRow & { canonicalPartId: string }>
          >(Prisma.sql`
            SELECT f."canonicalPartId", f."vehicleConfigId", f."evidenceLevel", f."verificationStatus",
                   coalesce(e."evidenceType", f.source, 'UNKNOWN') AS "evidenceType", coalesce(e.source, f.source) AS source
            FROM "Fitment" f LEFT JOIN "FitmentEvidence" e ON e."fitmentId" = f.id
            WHERE f."canonicalPartId" = ANY(${ids}::text[]) AND f."vehicleConfigId" = ANY(${vehicle.configIds}::text[])`)
        : Promise.resolve(
            [] as Array<EvidenceRow & { canonicalPartId: string }>,
          ),
      this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT DISTINCT "canonicalPartId" AS id FROM "Fitment" WHERE "canonicalPartId" = ANY(${ids}::text[])`),
    ]);

    const offersByPart = new Map<string, OfferRow[]>();
    for (const row of offerRows) {
      const list = offersByPart.get(row.canonicalPartId) ?? [];
      list.push(row);
      offersByPart.set(row.canonicalPartId, list);
    }
    const evidenceByPart = new Map<string, EvidenceRow[]>();
    for (const row of evidence) {
      const list = evidenceByPart.get(row.canonicalPartId) ?? [];
      list.push(row);
      evidenceByPart.set(row.canonicalPartId, list);
    }
    const withFitment = new Set(anyFitment.map((row) => row.id));
    const vehicleMake = normalizeMvlToken(vehicle?.make);
    const vehicleModel = normalizeMvlToken(vehicle?.model);

    return candidates.map((candidate) => {
      const { part } = candidate;
      const offers = toInternalOffers(offersByPart.get(part.id) ?? []);
      const compatRows = compat.get(part.id) ?? [];
      const documented = summarizeDocumented(mergeCompatRows(compatRows));
      const compatibilityListsVehicle = Boolean(
        vehicle &&
        compatRows.some(
          (row) =>
            row.source === 'list' &&
            normalizeMvlToken(row.make) === vehicleMake &&
            normalizeMvlToken(row.model) === vehicleModel &&
            row.minYear <= vehicle.year &&
            row.maxYear >= vehicle.year,
        ),
      );
      const verdict = decideVerdict({
        vehicle,
        evidence: evidenceByPart.get(part.id) ?? [],
        compatibilityListsVehicle,
        documented,
        hasAnyFitment: withFitment.has(part.id) || compatRows.length > 0,
        title: part.title,
        position: part.position,
        querySide: parsed.side,
      });
      const numbers = [
        ...new Set(
          numbersOfPart(part)
            .map((ref) => ref.number)
            .filter(isSignificantNumber),
        ),
      ];
      const label =
        candidate.relation === 'text'
          ? 'Match'
          : GROUP_LABELS[candidate.relation];
      return {
        partId: part.id,
        title: part.title,
        brand: part.brand,
        partSource: part.partSource,
        qualityTier: part.qualityTier,
        category: part.category,
        partType:
          part.partType && part.partType !== 'UNCLASSIFIED'
            ? part.partType
            : null,
        position: part.position,
        manufacturerPartNumber: part.manufacturerPartNumber,
        image: part.imageUrls[0] ?? null,
        imageCount: part.imageUrls.length,
        slug: part.slug,
        publicUrl: part.slug
          ? `https://partsbazar360.com/parts/${part.slug}`
          : `https://partsbazar360.com/part/${part.id}`,
        numbers,
        match: {
          relation: candidate.relation,
          label,
          matchedNumber: candidate.matched?.display ?? null,
          trail: candidate.trail,
          note: candidate.note,
          asked:
            candidate.relation === 'text'
              ? matchesAsked(part.title, parsed)
              : true,
        },
        fitment: verdict
          ? { ...verdict, documented }
          : { verdict: null, reason: null, evidence: [] as [], documented },
        availability: summarizeAvailability(offers),
        offers,
        relevanceRank: candidate.relevanceRank,
      };
    });
  }

  // ------------------------------------------------------ grouping/sorting

  private compare(hasVehicle: boolean, byRelevance: boolean) {
    const verdictIndex = (item: OptionItem) =>
      item.fitment.verdict
        ? VERDICT_ORDER.indexOf(item.fitment.verdict)
        : VERDICT_ORDER.length;
    return (a: OptionItem, b: OptionItem): number => {
      if (
        hasVehicle ||
        a.fitment.verdict === 'does_not_fit' ||
        b.fitment.verdict === 'does_not_fit'
      ) {
        const v = verdictIndex(a) - verdictIndex(b);
        if (v) return v;
      }
      const av =
        AVAILABILITY_ORDER.indexOf(a.availability.status) -
        AVAILABILITY_ORDER.indexOf(b.availability.status);
      if (av) return av;
      if (byRelevance && a.relevanceRank !== b.relevanceRank)
        return a.relevanceRank - b.relevanceRank;
      const cond =
        conditionRank(a.availability.bestCondition) -
        conditionRank(b.availability.bestCondition);
      if (cond) return cond;
      const pa = a.availability.priceMin ?? Number.POSITIVE_INFINITY;
      const pb = b.availability.priceMin ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return a.partId.localeCompare(b.partId);
    };
  }

  private group(
    items: OptionItem[],
    mode: OptionsResponse['mode'],
    hasVehicle: boolean,
    includeUnavailable: boolean,
  ): OptionGroup[] {
    const buckets = new Map<GroupKey, OptionItem[]>();
    const keyOf = (item: OptionItem): GroupKey => {
      if (mode === 'number') return item.match.relation as Relation;
      if (item.fitment.verdict === 'does_not_fit') return 'does_not_fit';
      if (item.match.asked === false) return 'related';
      if (!hasVehicle) return 'matches';
      return (item.fitment.verdict ?? 'unverified') as GroupKey;
    };
    for (const item of items) {
      const key = keyOf(item);
      const list = buckets.get(key) ?? [];
      list.push(item);
      buckets.set(key, list);
    }
    const order: GroupKey[] =
      mode === 'number'
        ? RELATION_ORDER
        : hasVehicle
          ? [
              'fits',
              'likely',
              'universal',
              'unverified',
              'related',
              'does_not_fit',
            ]
          : ['matches', 'related', 'does_not_fit'];
    const compare = this.compare(hasVehicle, mode === 'text');
    return order
      .filter((key) => buckets.has(key))
      .map((key) => {
        const all = buckets.get(key)!.sort(compare);
        const visible = includeUnavailable
          ? all
          : all.filter((item) => item.availability.status !== 'not_available');
        return {
          key,
          label: GROUP_LABELS[key],
          total: all.length,
          hiddenUnavailable: all.length - visible.length,
          collapsedByDefault:
            key === 'possible' || key === 'does_not_fit' || key === 'related',
          items: visible.slice(0, MAX_PER_GROUP),
        };
      });
  }

  private summarize(
    items: OptionItem[],
    vehicle: ResolvedVehicle | null,
    excludedOtherMake: number,
  ): OptionsResponse['summary'] {
    const count = (predicate: (item: OptionItem) => boolean) =>
      items.filter(predicate).length;
    const inStock = count((i) => i.availability.status === 'in_stock');
    const inStockFits = count(
      (i) =>
        i.availability.status === 'in_stock' && i.fitment.verdict === 'fits',
    );
    const likely = count((i) => i.fitment.verdict === 'likely');
    const canSource = count((i) => i.availability.status === 'can_source');
    const notAvailable = count(
      (i) => i.availability.status === 'not_available',
    );
    const possibleEquivalents = count((i) => i.match.relation === 'possible');
    const parts: string[] = [];
    parts.push(
      vehicle
        ? `${inStockFits} in stock that fit your ${vehicle.label}`
        : `${inStock} in stock`,
    );
    if (vehicle && likely) parts.push(`${likely} likely fit`);
    if (canSource) parts.push(`${canSource} can be sourced`);
    if (possibleEquivalents)
      parts.push(`${possibleEquivalents} equivalents unverified`);
    if (notAvailable) parts.push(`${notAvailable} not available now`);
    return {
      totalOptions: items.length,
      inStock,
      inStockFits,
      likely,
      canSource,
      notAvailable,
      possibleEquivalents,
      excludedOtherMake,
      sentence: `${items.length} option${items.length === 1 ? '' : 's'}: ${parts.join(', ')}.`,
    };
  }

  private interpretation(
    parsed: ParsedQuery,
    vehicle: ResolvedVehicle | null,
    vehicleSource: 'selected' | 'query',
  ): OptionsResponse['query']['interpreted'] {
    const chips: OptionsResponse['query']['interpreted'] = [];
    if (parsed.partNumbers.length)
      chips.push({
        key: 'number',
        label: 'Part number',
        value: parsed.partNumbers.join(', '),
      });
    if (parsed.make)
      chips.push({ key: 'make', label: 'Make', value: parsed.make });
    if (parsed.model)
      chips.push({ key: 'model', label: 'Model', value: parsed.model });
    if (parsed.year)
      chips.push({ key: 'year', label: 'Year', value: String(parsed.year) });
    if (parsed.side)
      chips.push({
        key: 'side',
        label: 'Side',
        value: parsed.side === 'LEFT' ? 'Left' : 'Right',
      });
    if (parsed.positions.length)
      chips.push({
        key: 'position',
        label: 'Position',
        value: parsed.positions.map((p) => p.toLowerCase()).join(', '),
      });
    if (vehicle?.engineLitres && vehicleSource === 'query')
      chips.push({
        key: 'engine',
        label: 'Engine',
        value: `${vehicle.engineLitres.toFixed(1)} L`,
      });
    return chips;
  }

  private async resolveIndex(): Promise<string> {
    try {
      const response = await this.client.indices.existsAlias({
        name: SEARCH_ALIAS,
      });
      if (Boolean((response as any)?.body ?? response)) return SEARCH_ALIAS;
    } catch {
      /* fall through */
    }
    return physicalIndexName(SEARCH_INDEX_VERSION);
  }
}

/**
 * Does a title name the part that was asked for? Uses the parser's part terms
 * and synonyms ("headlight" → headlamp, head light, …); with no recognised
 * phrase, every descriptive word must appear. Separators are ignored.
 */
export function matchesAsked(title: string, parsed: ParsedQuery): boolean {
  const tokens = parsed.freeText
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (!tokens.length) return true;
  const compact = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const text = compact(title);
  if (
    parsed.expandedTerms.some(
      (term) => compact(term).length >= 3 && text.includes(compact(term)),
    )
  )
    return true;
  return tokens.every((token) =>
    text.includes(
      token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token,
    ),
  );
}

interface CompatRow {
  make: string;
  model: string;
  minYear: number;
  maxYear: number;
  /** `compatibility` list on the part, or structured Fitment rows. */
  source: 'list' | 'fitment';
}

/** One row per make + model (names normalized), year ranges widened. */
export function mergeCompatRows(rows: CompatRow[]): CompatRow[] {
  const byKey = new Map<string, CompatRow>();
  for (const row of rows) {
    const key = `${normalizeMvlToken(row.make)}|${normalizeMvlToken(row.model)}`;
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, { ...row });
    else {
      existing.minYear = Math.min(existing.minYear, row.minYear);
      existing.maxYear = Math.max(existing.maxYear, row.maxYear);
      if (row.source === 'list') existing.source = 'list';
    }
  }
  return [...byKey.values()];
}
