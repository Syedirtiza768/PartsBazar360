/**
 * v1 search service — the new query path (brief §14).
 *
 * Reads through the `parts_search` alias so index rebuilds and rollbacks are
 * invisible here. Falls back to the current physical v2 index when the alias
 * has not been promoted yet, which is how this runs safely alongside the
 * existing `/search/parts` endpoint during rollout.
 *
 * Returns the response envelope the brief specifies: results, pagination,
 * applied filters, available facets, the query interpretation, corrections,
 * execution metadata, and a request id.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from '@opensearch-project/opensearch';
import {
  buildFilters,
  buildSearchQuery,
  type SearchFilters,
  type SortOption,
} from '../query/relevance.builder';
import {
  SEARCH_ALIAS,
  SEARCH_INDEX_VERSION,
  physicalIndexName,
} from '../index/search-index.schema';
import type { SearchQueryDto } from './search-query.dto';

const DEFAULT_PAGE_SIZE = 24;

/**
 * Below this many strict matches, the service retries the query relaxed and
 * tells the buyer the results are related rather than exact.
 */
const RELAX_THRESHOLD = Number(process.env.SEARCH_RELAX_THRESHOLD || 5);

/** Facet dimensions and the document field each aggregates over. */
const FACET_FIELDS = {
  category: 'category',
  brand: 'brand',
  make: 'makes',
  model: 'models',
  partType: 'partType',
  sourceTag: 'sourceTags',
  side: 'side',
  year: 'years',
  seller: 'sellerNames',
} as const;

type FacetKey = keyof typeof FACET_FIELDS;

export interface SearchFacetBucket {
  value: string;
  count: number;
}

export interface SearchV1Response {
  query: {
    original: string;
    normalized: string;
    interpreted: Record<string, unknown>;
  };
  results: any[];
  facets: Record<string, SearchFacetBucket[]>;
  appliedFilters: Record<string, unknown>;
  pagination: {
    page: number;
    pageSize: number;
    totalResults: number;
    totalRelation: 'eq' | 'gte';
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  corrections: Array<{ type: string; message: string; suggestion?: string }>;
  meta: { tookMs: number; index: string; degraded: boolean };
  requestId: string;
}

@Injectable()
export class SearchV1Service {
  private readonly logger = new Logger(SearchV1Service.name);
  private client: Client;

  constructor() {
    this.client = new Client({
      node: process.env.OPENSEARCH_URL || 'http://opensearch:9200',
      requestTimeout: Number(process.env.SEARCH_TIMEOUT_MS || 5000),
    });
  }

  /** Alias when promoted, otherwise the physical v2 index. */
  private async resolveIndex(): Promise<string> {
    try {
      const response = await this.client.indices.existsAlias({ name: SEARCH_ALIAS });
      if (Boolean((response as any)?.body ?? response)) return SEARCH_ALIAS;
    } catch {
      /* fall through */
    }
    return physicalIndexName(SEARCH_INDEX_VERSION);
  }

  private toFilters(dto: SearchQueryDto): SearchFilters {
    return {
      category: dto.category,
      brand: dto.brand,
      make: dto.make,
      model: dto.model,
      partType: dto.partType,
      sourceTag: dto.sourceTag,
      condition: dto.condition,
      seller: dto.seller,
      year: dto.year,
      priceMin: dto.priceMin,
      priceMax: dto.priceMax,
      hasImage: dto.hasImage,
      inStock: dto.inStock,
      vehicleConfigId: dto.vehicleConfigId,
      includeInterchange: dto.includeInterchange,
    };
  }

  /**
   * Facet aggregations with correct exclusion logic (brief §11): each
   * dimension is counted against every *other* active filter, so a count
   * answers "how many results if I add this?" rather than reflecting a
   * selection that has already been applied to itself.
   */
  private buildAggregations(dto: SearchQueryDto, core: any) {
    const aggs: Record<string, any> = {};

    for (const [key, field] of Object.entries(FACET_FIELDS) as Array<[FacetKey, string]>) {
      const scoped = this.toFilters(dto);
      delete (scoped as Record<string, unknown>)[key];

      aggs[key] = {
        filter: { bool: { filter: buildFilters(scoped), must: [core] } },
        aggs: {
          values: {
            terms: {
              field,
              size: key === 'year' ? 40 : 60,
              order: key === 'year' ? { _key: 'desc' } : { _count: 'desc' },
            },
          },
        },
      };
    }

    // Condition lives on nested offers, so it needs a nested agg.
    const conditionScope = this.toFilters(dto);
    delete conditionScope.condition;
    aggs.condition = {
      filter: { bool: { filter: buildFilters(conditionScope), must: [core] } },
      aggs: {
        nested: {
          nested: { path: 'offers' },
          aggs: { values: { terms: { field: 'offers.condition', size: 10 } } },
        },
      },
    };

    // Price histogram for the range control.
    const priceScope = this.toFilters(dto);
    delete priceScope.priceMin;
    delete priceScope.priceMax;
    aggs.price = {
      filter: { bool: { filter: buildFilters(priceScope), must: [core] } },
      aggs: {
        stats: { stats: { field: 'minPrice' } },
      },
    };

    // Availability toggles.
    aggs.availability = {
      filter: { bool: { filter: buildFilters(this.toFilters(dto)), must: [core] } },
      aggs: {
        hasImage: { filter: { term: { hasImage: true } } },
        inStock: { filter: { term: { inStock: true } } },
      },
    };

    return aggs;
  }

  private readFacets(raw: any): Record<string, SearchFacetBucket[]> {
    const out: Record<string, SearchFacetBucket[]> = {};
    const buckets = (node: any): SearchFacetBucket[] =>
      (node?.values?.buckets ?? []).map((bucket: any) => ({
        value: String(bucket.key),
        count: bucket.doc_count,
      }));

    for (const key of Object.keys(FACET_FIELDS)) out[key] = buckets(raw?.[key]);
    out.condition = buckets(raw?.condition?.nested);

    const stats = raw?.price?.stats;
    out.price = stats?.count
      ? [
          { value: 'min', count: Math.floor(stats.min ?? 0) },
          { value: 'max', count: Math.ceil(stats.max ?? 0) },
        ]
      : [];

    out.availability = [
      { value: 'hasImage', count: raw?.availability?.hasImage?.doc_count ?? 0 },
      { value: 'inStock', count: raw?.availability?.inStock?.doc_count ?? 0 },
    ];

    return out;
  }

  async search(dto: SearchQueryDto): Promise<SearchV1Response> {
    const requestId = randomUUID();
    const startedAt = Date.now();

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? DEFAULT_PAGE_SIZE;
    const sort: SortOption = dto.sort ?? 'relevance';
    const filters = this.toFilters(dto);

    let { parsed, query, sort: sortClause } = buildSearchQuery(dto.q, filters, sort);
    const index = await this.resolveIndex();

    // Strict matching requires every term of a short query, which is what makes
    // "Audi Bumper" return Audi bumpers rather than every bumper in stock. When
    // the catalogue genuinely has no such part it returns almost nothing
    // ("front bumper for 2018 Accord" → 1 wrong result), so a thin result set
    // is retried relaxed and labelled as related rather than exact (brief §12).
    let relaxed = false;
    if (dto.q && parsed.matchText && page === 1) {
      const probe: any = await this.client
        .count({ index, body: { query } as any })
        .catch(() => null);
      const strictTotal = Number(probe?.body?.count ?? -1);
      if (strictTotal >= 0 && strictTotal < RELAX_THRESHOLD) {
        relaxed = true;
        ({ parsed, query, sort: sortClause } = buildSearchQuery(
          dto.q,
          filters,
          sort,
          'relaxed',
        ));
      }
    }

    const interpreted: Record<string, unknown> = {};
    if (parsed.year) interpreted.year = parsed.year;
    if (parsed.yearRange) interpreted.yearRange = parsed.yearRange;
    if (parsed.make) interpreted.make = parsed.make;
    if (parsed.model) interpreted.model = parsed.model;
    if (parsed.chassis) interpreted.chassis = parsed.chassis;
    if (parsed.engineLitres) interpreted.engineLitres = parsed.engineLitres;
    if (parsed.side) interpreted.side = parsed.side;
    if (parsed.positions.length) interpreted.positions = parsed.positions;
    if (parsed.condition) interpreted.condition = parsed.condition;
    if (parsed.partNumbers.length) interpreted.partNumbers = parsed.partNumbers;
    if (parsed.synonymGroups.length) interpreted.partType = parsed.synonymGroups[0];

    const corrections: SearchV1Response['corrections'] = [];
    if (relaxed) {
      corrections.push({
        type: 'relaxed',
        message: `No exact matches for “${parsed.original}” — showing related parts.`,
      });
    }
    if (parsed.synonymGroups.length) {
      corrections.push({
        type: 'synonym',
        message: `Also searching for equivalents of “${parsed.synonymGroups.join('”, “')}”`,
      });
    }

    // The core query, reused by every facet aggregation so counts agree with
    // the visible result set.
    const core = query.function_score.query.bool.must[0];

    try {
      const response: any = await this.client.search({
        index,
        body: {
          from: (page - 1) * pageSize,
          size: pageSize,
          track_total_hits: true,
          query,
          sort: sortClause,
          aggs: this.buildAggregations(dto, core),
        } as any,
      });

      const totalRaw = response.body.hits.total;
      const totalResults =
        typeof totalRaw === 'number' ? totalRaw : Number(totalRaw?.value ?? 0);
      const totalRelation: 'eq' | 'gte' =
        typeof totalRaw !== 'number' && totalRaw?.relation === 'gte' ? 'gte' : 'eq';
      const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));

      const results = response.body.hits.hits.map((hit: any) => {
        const matched: string[] = hit.matched_queries ?? [];
        const primary = ['oem', 'sku', 'normalized'].some((name) => matched.includes(name));
        return {
          id: hit._id,
          score: hit._score,
          ...hit._source,
          // Tell the buyer *why* this matched — the brief's "why this fits".
          matchedVia: matched.length ? matched : undefined,
          matchedViaInterchange:
            !primary && (matched.includes('interchange') || matched.includes('superseded')),
        };
      });

      return {
        query: { original: parsed.original, normalized: parsed.normalized, interpreted },
        results,
        facets: this.readFacets(response.body.aggregations),
        appliedFilters: Object.fromEntries(
          Object.entries(filters).filter(([, value]) =>
            Array.isArray(value) ? value.length > 0 : value != null,
          ),
        ),
        pagination: {
          page,
          pageSize,
          totalResults,
          totalRelation,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        corrections,
        meta: { tookMs: Date.now() - startedAt, index, degraded: false },
        requestId,
      };
    } catch (error: any) {
      // Never leave the caller with an indefinite loading state: return a
      // well-formed empty envelope flagged `degraded` so the UI can show a
      // real error rather than a spinner (brief §22).
      this.logger.error(
        `search failed [${requestId}]: ${error?.message}`,
        error?.stack,
      );
      return {
        query: { original: parsed.original, normalized: parsed.normalized, interpreted },
        results: [],
        facets: {},
        appliedFilters: {},
        pagination: {
          page,
          pageSize,
          totalResults: 0,
          totalRelation: 'eq',
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: page > 1,
        },
        corrections: [
          { type: 'error', message: 'Search is temporarily unavailable. Please retry.' },
        ],
        meta: { tookMs: Date.now() - startedAt, index, degraded: true },
        requestId,
      };
    }
  }
}
