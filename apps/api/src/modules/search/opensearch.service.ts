import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { normalizePartNumber } from '../catalog-import/part-normalization.util';
import { sanitizeSearchItem } from './buyer-visible-offers.util';
import {
  sanitizeIdentifier,
  sanitizeIdentifierList,
} from './identifier-sanitize.util';

export type BrowseSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';

export interface BrowseFacets {
  brands: Array<{ name: string; count: number }>;
  categories: Array<{ name: string; count: number }>;
  makes: Array<{ name: string; count: number }>;
  partTypes: Array<{ name: string; count: number }>;
  sourceTags: Array<{ name: string; count: number }>;
}

export interface BrowseResult {
  items: any[];
  total: number;
  /** 'eq' = exact count; 'gte' = at least (only when a result window is hit). */
  totalRelation: 'eq' | 'gte';
  page: number;
  limit: number;
  /** Highest page reachable by offset pagination (result window / page size). */
  maxPage: number;
  facets: BrowseFacets;
  /**
   * True when strict matching found almost nothing and the query was retried
   * with terms optional. These are related parts, not exact ones, and the
   * buyer UI should say so rather than presenting them as matches.
   */
  relaxed?: boolean;
}

/** Coerce a query param (string | string[] | comma-list) into a de-duplicated string[]. */
function asArray(value: string | string[] | undefined | null): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const v = String(raw ?? '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** How strictly the descriptive terms of a browse query must all match. */
type MatchStrictness = 'strict' | 'relaxed';

/**
 * `3<75%` — require every term of a short query, 75% beyond three terms.
 * `relaxed` is the fallback for when the catalogue genuinely has no such part:
 * strict matching on a long query ("front bumper for 2018 Audi Q7", 6 terms)
 * would otherwise return an empty page rather than close alternatives.
 */
const BROWSE_MSM: Record<MatchStrictness, string> = {
  strict: '3<75%',
  relaxed: '2<50%',
};

@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private client!: Client;
  private readonly INDEX_NAME = 'canonical_parts';
  /**
   * OpenSearch caps `from + size` at `index.max_result_window` (default 10_000).
   * Without raising it, deep pages throw and the buyer cannot reach listings
   * past ~page 416 (24/page). Raised here so the full active catalog is
   * reachable; tuned via env for very large catalogs. Above this ceiling,
   * deep pages return empty gracefully (cursor-based retrieval is the
   * documented Stage-7 path for >100k catalogs).
   */
  private readonly maxResultWindow = Math.max(
    10000,
    parseInt(process.env.OPENSEARCH_MAX_RESULT_WINDOW || '100000', 10) || 100000,
  );

  onModuleInit() {
    this.client = new Client({
      node: process.env.OPENSEARCH_URL || 'http://localhost:9200',
    });
    this.logger.log('OpenSearch Service initialized');
    // Make the index self-managing + raise the result window without blocking
    // startup. track_total_hits makes accurate totals work immediately; the
    // window raise (deep-page reach) applies within seconds of boot.
    void this.ensureIndex().catch((err) =>
      this.logger.warn(`ensureIndex failed: ${err?.message || err}`),
    );
  }

  /**
   * Make the app own its index schema instead of relying on a one-off script.
   * - Creates the index with explicit settings + mapping if absent.
   * - Raises `index.max_result_window` on an existing index (the 10k cap fix).
   * - Best-effort adds fields the legacy manual mapping omitted.
   * All steps are idempotent and individually fault-tolerant so a partial
   * failure never blocks search.
   */
  private async ensureIndex(): Promise<void> {
    const index = this.INDEX_NAME;
    let exists = false;
    try {
      const r = await this.client.indices.exists({ index });
      // opensearch-js v3 returns an ApiResponse whose body is the boolean;
      // older returns return the boolean directly.
      exists = Boolean((r as any)?.body ?? r);
    } catch (err: any) {
      this.logger.warn(`ensureIndex: exists check failed: ${err?.message || err}`);
    }

    if (!exists) {
      try {
        await this.client.indices.create({
          index,
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              max_result_window: this.maxResultWindow,
            },
            mappings: { properties: this.indexMapping() },
          },
        });
        this.logger.log(
          `Created index ${index} (max_result_window=${this.maxResultWindow})`,
        );
        return;
      } catch (err: any) {
        // Race: another replica created it between our check and create.
        this.logger.warn(`ensureIndex: create failed: ${err?.message || err}`);
      }
    }

    // Raise the window on an existing index. This is the operative fix for
    // "go beyond 10,000 listings". Dynamic setting; safe on an open index.
    try {
      await this.client.indices.putSettings({
        index,
        body: { 'index.max_result_window': this.maxResultWindow },
      });
      this.logger.log(
        `Raised ${index}.max_result_window → ${this.maxResultWindow}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `ensureIndex: could not raise max_result_window: ${err?.message || err}`,
      );
    }

    // Best-effort: declare fields the legacy manual mapping omitted so they
    // get proper types instead of dynamic guesses. Non-fatal — a conflict on
    // an existing field just logs and is ignored.
    try {
      await this.client.indices.putMapping({
        index,
        body: {
          properties: {
            fitmentConfidence: { type: 'float' },
            listingUrl: { type: 'keyword', index: false },
            ebayItemId: { type: 'keyword' },
          },
        },
      });
    } catch (err: any) {
      this.logger.debug(
        `ensureIndex: mapping enrichment skipped: ${err?.message || err}`,
      );
    }
  }

  /** Explicit mapping so the index is reproducible from the app, not a script. */
  private indexMapping(): Record<string, any> {
    return {
      id: { type: 'keyword' },
      title: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 512 } } },
      partType: { type: 'keyword' },
      brand: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
      manufacturerPartNumber: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 512 } } },
      partNumbers: { type: 'object', enabled: false },
      normalizedPartNumbers: { type: 'keyword' },
      interchangePartNumbers: { type: 'keyword' },
      category: { type: 'keyword' },
      makes: { type: 'keyword' },
      oeNumbers: { type: 'keyword' },
      imageUrls: { type: 'keyword', index: false },
      listingUrl: { type: 'keyword', index: false },
      ebayItemId: { type: 'keyword' },
      compatibility: { type: 'object', enabled: false },
      partSource: { type: 'keyword' },
      qualityTier: { type: 'keyword' },
      fitmentStatus: { type: 'keyword' },
      fitmentConfidence: { type: 'float' },
      createdAt: { type: 'date' },
      minPrice: { type: 'float' },
      fitments: { type: 'keyword' },
      offers: {
        type: 'nested',
        properties: {
          id: { type: 'keyword' },
          price: { type: 'float' },
          currency: { type: 'keyword' },
          condition: { type: 'keyword' },
          partSource: { type: 'keyword' },
          qualityTier: { type: 'keyword' },
          sellerId: { type: 'keyword' },
          sellerName: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
          sourceTag: { type: 'keyword' },
        },
      },
      sourceTags: { type: 'keyword' },
    };
  }

  async indexPart(part: any) {
    try {
      const rawOffers = Array.isArray(part.offers) ? part.offers : [];
      const offers = rawOffers.filter((o: any) => {
        if (!o) return false;
        if (o.sellerId === 'seed-febest-inventory-supplier') return false;
        if (o.status && o.status !== 'ACTIVE') return false;
        const sellerStatus =
          o.seller?.onboardingStatus || o.sellerOnboardingStatus;
        if (sellerStatus && sellerStatus !== 'ACTIVE') return false;
        const sellerName = o.sellerName || o.seller?.name || '';
        if (/febest\s+inventory\s+supplier/i.test(sellerName)) return false;
        return true;
      });

      if (offers.length === 0) {
        try {
          await this.client.delete({ index: this.INDEX_NAME, id: part.id });
        } catch {
          /* ignore missing */
        }
        this.logger.debug(
          `Removed part ${part.id} from OpenSearch (no buyer-visible offers)`,
        );
        return;
      }

      const minPrice = Math.min(...offers.map((o: any) => o.price ?? Infinity));

      await this.client.index({
        index: this.INDEX_NAME,
        id: part.id,
        body: {
          id: part.id,
          title: part.title,
          partType: part.partType || null,
          brand: part.brand,
          // Guarded: these are the highest-boosted fields in browseParts, and
          // the feeds write part-name words ("BUMPER", "AUDI") into them. See
          // identifier-sanitize.util.ts.
          manufacturerPartNumber: sanitizeIdentifier(
            part.manufacturerPartNumber,
          ),
          partNumbers: part.partNumbers || [],
          // Primary-identity numbers only (exclude interchange, which lives in
          // interchangePartNumbers below). This keeps a "primary" number match
          // distinct from an "interchange" match so the toggle can exclude the
          // latter and results can be labelled by how they matched.
          normalizedPartNumbers: (part.partNumbers || [])
            .filter(
              (number: any) => number.numberType !== 'OEM_CROSS_REFERENCE',
            )
            .map((number: any) => number.normalizedNumber)
            .filter(Boolean),
          category: part.category,
          // Extract unique makes from both compatibility data and any
          // explicit makes array passed by callers (e.g. from structured
          // fitments where the caller already resolved the make name).
          makes: [...new Set([
            ...(part.compatibility || [])
              .map((c: any) => c.make)
              .filter(Boolean),
            ...(part.makes || []).filter(Boolean),
          ])],
          oeNumbers: sanitizeIdentifierList(part.oeNumbers),
          // Split part numbers by role so search can offer an interchange
          // toggle. `normalizedPartNumbers` stays primary-identity only
          // (OEM / MPN / genuine) — it is what a "this exact part" match uses.
          // Interchange / analogue numbers (OEM_CROSS_REFERENCE) go in their
          // own field so they can be included or excluded per query and, when
          // they match, labelled as an interchange hit rather than an exact one.
          interchangePartNumbers: (part.partNumbers || [])
            .filter(
              (number: any) => number.numberType === 'OEM_CROSS_REFERENCE',
            )
            .map((number: any) => number.normalizedNumber)
            .filter(Boolean),
          imageUrls: part.imageUrls || [],
          listingUrl: part.listingUrl || null,
          ebayItemId: part.ebayItemId || null,
          compatibility: part.compatibility || null,
          partSource: part.partSource || null,
          qualityTier: part.qualityTier || null,
          fitmentStatus: part.fitmentStatus || null,
          fitmentConfidence: part.fitmentConfidence ?? null,
          createdAt: part.createdAt || new Date().toISOString(),
          minPrice: Number.isFinite(minPrice) ? minPrice : null,
          // Only structured, high-confidence evidence can power a green "fits"
          // result. Title-inferred D-level matches remain available on the PDP
          // as advisory compatibility and never enter guaranteed-fit search.
          fitments: (part.fitments || [])
            .filter(
              (f: any) =>
                ['A', 'B'].includes(f.evidenceLevel) &&
                Number(f.confidence) >= 0.8,
            )
            .map((f: any) => f.vehicleConfigId),
          offers: offers.map((o: any) => ({
            id: o.id,
            price: o.price,
            // Currency must travel with the price — cards previously assumed
            // USD for indexed offers while the PDP showed the real currency.
            currency: o.currency || null,
            condition: o.condition,
            partSource: o.partSource || null,
            qualityTier: o.qualityTier || null,
            sellerId: o.sellerId,
            sellerName: o.sellerName || o.seller?.name || null,
            sourceTag: o.sourceTag || null,
          })),
          sourceTags: [...new Set(offers.map((o: any) => o.sourceTag).filter(Boolean))],
        },
        refresh: process.env.OPENSEARCH_REFRESH_ON_INDEX === 'true',
      });
      this.logger.debug(`Indexed part ${part.id} into OpenSearch`);
    } catch (error) {
      this.logger.error(`Failed to index part ${part.id}`, error.stack);
    }
  }

  async searchCompatibleParts(
    vehicleConfigId: string,
    query?: string,
    opts?: { page?: number; limit?: number },
  ) {
    try {
      const page = Math.max(1, opts?.page || 1);
      const limit = Math.min(Math.max(1, opts?.limit || 24), 200);
      const from = (page - 1) * limit;

      const must: any[] = [{ term: { 'fitments.keyword': vehicleConfigId } }];

      if (query) {
        must.push({
          bool: {
            should: [
              {
                multi_match: {
                  query,
                  fields: [
                    'title',
                    'brand',
                    'category',
                    'manufacturerPartNumber',
                    'oeNumbers',
                  ],
                },
              },
              {
                term: {
                  'normalizedPartNumbers.keyword': normalizePartNumber(query),
                },
              },
            ],
            minimum_should_match: 1,
          },
        });
      }

      const response = await this.client.search({
        index: this.INDEX_NAME,
        body: {
          from,
          size: limit,
          track_total_hits: true,
          query: {
            bool: {
              must,
            },
          },
          sort: [{ minPrice: { order: 'asc', missing: '_last' } }],
        } as any,
      });

      const totalRaw = response.body.hits.total;
      const total =
        typeof totalRaw === 'number' ? totalRaw : Number(totalRaw?.value || 0);
      const items = response.body.hits.hits.map((hit: any) => ({
        id: hit._id,
        ...(hit._source as object),
      }));

      return { items, total, page, limit };
    } catch (error) {
      this.logger.error(
        `Search failed for vehicleConfigId ${vehicleConfigId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * General catalog browsing — no vehicle selection required. Powers the
   * "shop all parts" experience (and SEO-crawlable listing pages) with
   * keyword search, multi-select brand/category/make/part-type filters,
   * relevance ranking, sorting and server-side pagination.
   *
   * Facet counts are scoped to the *other* active filters (post-filter facets)
   * so the numbers beside each option always agree with the visible result
   * set — never the contradictory global counts the old sidebar showed.
   */
  async browseParts(opts: {
    q?: string;
    category?: string | string[];
    brand?: string | string[];
    make?: string | string[];
    partType?: string | string[];
    sourceTag?: string | string[];
    sort?: BrowseSort;
    page?: number;
    limit?: number;
    /**
     * Include interchange / analogue (OEM_CROSS_REFERENCE) numbers in a
     * part-number search. Default true — a buyer holding a superseded number
     * should find the part without knowing the concept "interchange". Turning
     * it off restricts matching to the part's own primary identity numbers.
     */
    includeInterchange?: boolean;
  }): Promise<BrowseResult> {
    const {
      q,
      sort = 'relevance',
      page = 1,
      limit = 24,
      includeInterchange = true,
    } = opts;

    const pageNum = Math.max(1, Math.floor(page || 1));
    const size = Math.min(Math.max(1, Math.floor(limit || 24)), 200);
    const maxPage = Math.max(1, Math.floor(this.maxResultWindow / size));
    const hasQuery = !!(q && q.trim());

    const cats = asArray(opts.category);
    const brands = asArray(opts.brand);
    const makes = asArray(opts.make);
    const partTypes = asArray(opts.partType);
    const sourceTags = asArray(opts.sourceTag);

    // --- relevance clauses (weighted should). Exact normalized part-number
    //     dominates (boost 60); interchange cross-reference is a strong but
    //     secondary signal (boost 25) so it never outranks a primary match. ---
    //
    // The descriptive `multi_match` carries an explicit minimum_should_match.
    // Without it multi_match defaults to `operator: or`, so "Audi bumper"
    // matched every document containing *either* term — the union, 10,932
    // results against an Audi-bumper intersection of roughly 208. It was also
    // non-monotonic in the worst way for buyers: adding a term *widened* the
    // set ("Audi Q7 bumper" → 11,063) and an unmatchable token was silently
    // ignored ("zzzz bumper" returned exactly "bumper"'s 1,934).
    //
    // `3<75%` reads: with 3 terms or fewer require them ALL, beyond that
    // require 75%. A bare `75%` rounds *down*, which would still let a
    // two-token query match on one token and change nothing here.
    const buildQClause = (strictness: MatchStrictness): any | null => {
      if (!hasQuery) return null;
      const qq = q!.trim();
      const should: any[] = [
        {
          multi_match: {
            query: qq,
            fields: [
              'title^2',
              'brand',
              'category',
              'manufacturerPartNumber^3',
              'oeNumbers^2',
            ],
            minimum_should_match: BROWSE_MSM[strictness],
            _name: 'primary',
          },
        },
        // Part-number clauses stay outside the msm guard: a buyer pasting a
        // bare number must still resolve it, and the outer minimum_should_match
        // of 1 lets either signal satisfy the query on its own.
        {
          term: {
            'normalizedPartNumbers.keyword': {
              value: normalizePartNumber(qq),
              boost: 60,
              _name: 'primary',
            },
          },
        },
      ];
      if (includeInterchange) {
        should.push({
          term: {
            'interchangePartNumbers.keyword': {
              value: normalizePartNumber(qq),
              boost: 25,
              _name: 'interchange',
            },
          },
        });
      }
      return { bool: { should, minimum_should_match: 1 } };
    };

    let qClause = buildQClause('strict');
    let must: any[] = qClause ? [qClause] : [{ match_all: {} }];

    // --- filters: AND across dimensions, OR within (terms). ---
    const baseFilters: any[] = [
      // Browse only parts that still have at least one indexed offer.
      { exists: { field: 'offers.sellerId' } },
    ];
    if (cats.length) baseFilters.push({ terms: { 'category.keyword': cats } });
    if (brands.length) baseFilters.push({ terms: { 'brand.keyword': brands } });
    if (makes.length) baseFilters.push({ terms: { 'makes.keyword': makes } });
    if (partTypes.length)
      baseFilters.push({ terms: { 'partType.keyword': partTypes } });
    if (sourceTags.length)
      baseFilters.push({ terms: { 'sourceTags.keyword': sourceTags } });

    // --- sort. Relevance only means something for a keyword; a no-query
    //     browse falls back to newest so the feed is stable, not arbitrary. ---
    const useRelevance = sort === 'relevance' && hasQuery;
    const sortClause: any[] = useRelevance
      ? [{ _score: { order: 'desc' } }, { createdAt: { order: 'desc' } }]
      : sort === 'price_asc'
        ? [{ minPrice: { order: 'asc', missing: '_last' } }, { createdAt: { order: 'desc' } }]
        : sort === 'price_desc'
          ? [{ minPrice: { order: 'desc', missing: '_last' } }, { createdAt: { order: 'desc' } }]
          : [{ createdAt: { order: 'desc' } }];

    // --- scoped facets. Each dimension aggregates over every OTHER active
    //     filter (incl. the keyword), so counts answer "if I add this, how
    //     many results?" rather than the global total. ---
    const facetFilter = (exclude: string): any[] => {
      const f: any[] = [{ exists: { field: 'offers.sellerId' } }];
      if (exclude !== 'category' && cats.length)
        f.push({ terms: { 'category.keyword': cats } });
      if (exclude !== 'brand' && brands.length)
        f.push({ terms: { 'brand.keyword': brands } });
      if (exclude !== 'make' && makes.length)
        f.push({ terms: { 'makes.keyword': makes } });
      if (exclude !== 'partType' && partTypes.length)
        f.push({ terms: { 'partType.keyword': partTypes } });
      if (exclude !== 'sourceTag' && sourceTags.length)
        f.push({ terms: { 'sourceTags.keyword': sourceTags } });
      if (qClause) f.push(qClause);
      return f;
    };
    // Rebuilt per attempt: `facetFilter` closes over `qClause`, which the
    // relaxed retry below reassigns, and facet counts must describe the result
    // set the buyer is actually looking at.
    const buildAggs = () => ({
      categories: {
        filter: { bool: { filter: facetFilter('category') } },
        aggs: { names: { terms: { field: 'category.keyword', size: 50 } } },
      },
      brands: {
        filter: { bool: { filter: facetFilter('brand') } },
        aggs: { names: { terms: { field: 'brand.keyword', size: 50 } } },
      },
      makes: {
        filter: { bool: { filter: facetFilter('make') } },
        aggs: { names: { terms: { field: 'makes.keyword', size: 50 } } },
      },
      partTypes: {
        filter: { bool: { filter: facetFilter('partType') } },
        aggs: { names: { terms: { field: 'partType.keyword', size: 50 } } },
      },
      sourceTags: {
        filter: { bool: { filter: facetFilter('sourceTag') } },
        aggs: { names: { terms: { field: 'sourceTags.keyword', size: 50 } } },
      },
    });

    // Deep-page guard: from + size must stay inside max_result_window or
    // OpenSearch throws. Pages beyond the window return empty gracefully
    // (the frontend caps visible page count to total/size, so this is a
    // safety net against hand-edited URLs, not a normal path).
    const from = (pageNum - 1) * size;
    if (from + size > this.maxResultWindow) {
      return {
        items: [],
        total: 0,
        totalRelation: 'eq',
        page: pageNum,
        limit: size,
        maxPage,
        facets: emptyFacets(),
      };
    }

    try {
      const runSearch = () =>
        this.client.search({
          index: this.INDEX_NAME,
          body: {
            from,
            size,
            track_total_hits: true,
            query: { bool: { must, filter: baseFilters } },
            sort: sortClause,
            aggs: buildAggs(),
          } as any,
        });

      let response = await runSearch();
      let relaxed = false;

      // Strict matching is right when the catalogue has the part and wrong when
      // it does not — "front bumper for 2018 Audi Q7" would return an empty
      // page rather than close alternatives. An empty first page is retried
      // relaxed; deeper pages keep the strict query so pagination stays
      // consistent with the page-1 total the buyer was shown.
      //
      // Only a genuinely empty result set triggers the retry. Padding a thin
      // one is worse than leaving it thin: a pasted part number legitimately
      // returns a single hit, and treating that as "no exact matches, showing
      // related parts" mislabels a perfect match as a failure.
      if (hasQuery && pageNum === 1) {
        const strictTotalRaw = response.body.hits.total;
        const strictTotal =
          typeof strictTotalRaw === 'number'
            ? strictTotalRaw
            : Number(strictTotalRaw?.value || 0);
        if (strictTotal === 0) {
          qClause = buildQClause('relaxed');
          must = qClause ? [qClause] : [{ match_all: {} }];
          response = await runSearch();
          relaxed = true;
        }
      }

      const totalRaw = response.body.hits.total;
      const total =
        typeof totalRaw === 'number' ? totalRaw : Number(totalRaw?.value || 0);
      const totalRelation: 'eq' | 'gte' =
        typeof totalRaw !== 'number' && totalRaw?.relation === 'gte'
          ? 'gte'
          : 'eq';

      const aggsBody = (response.body.aggregations ?? {}) as Record<
        keyof BrowseFacets,
        FacetAgg
      >;
      const facets: BrowseFacets = {
        categories: bucketsOf(aggsBody.categories),
        brands: bucketsOf(aggsBody.brands),
        makes: bucketsOf(aggsBody.makes),
        partTypes: bucketsOf(aggsBody.partTypes),
        sourceTags: bucketsOf(aggsBody.sourceTags),
      };

      return {
        items: response.body.hits.hits.map((hit: any) => {
          // A hit that matched an interchange number but NOT a primary one was
          // found via a cross-reference — tell the buyer so, and echo back the
          // number they searched so the card can name it.
          const matched: string[] = hit.matched_queries || [];
          const viaInterchange =
            matched.includes('interchange') && !matched.includes('primary');
          return {
            id: hit._id,
            ...(hit._source as object),
            ...(viaInterchange
              ? { matchedVia: 'interchange', matchedNumber: q }
              : {}),
          };
        }),
        total,
        totalRelation,
        page: pageNum,
        limit: size,
        maxPage,
        facets,
        relaxed,
      };
    } catch (error) {
      this.logger.error('browseParts failed', error.stack);
      return {
        items: [],
        total: 0,
        totalRelation: 'eq',
        page: pageNum,
        limit: size,
        maxPage,
        facets: emptyFacets(),
      };
    }
  }

  /**
   * Lightweight autocomplete suggestions. Returns the top matching parts,
   * categories, and brands for a partial query. Designed to be called on
   * every keystroke (debounced client-side) so it must be sub-100ms.
   *
   * Applies the same buyer-visibility sanitization as browseParts so only
   * parts with at least one active, buyer-visible offer surface in the
   * dropdown — never ghost listings from hidden/inactive sellers.
   */
  async suggest(q: string): Promise<{
    parts: Array<{
      id: string;
      title: string;
      brand: string | null;
      category: string | null;
      imageUrl: string | null;
      minPrice: number | null;
      currency: string | null;
      manufacturerPartNumber: string | null;
    }>;
    categories: string[];
    brands: string[];
  }> {
    try {
      const normalized = normalizePartNumber(q);
      // Fetch more than we need so sanitization (which drops parts with no
      // buyer-visible offers) still leaves enough to fill the dropdown.
      const response = await this.client.search({
        index: this.INDEX_NAME,
        body: {
          size: 20,
          _source: [
            'id',
            'title',
            'brand',
            'category',
            'imageUrls',
            'minPrice',
            'manufacturerPartNumber',
            'offers.id',
            'offers.price',
            'offers.currency',
            'offers.sellerId',
            'offers.sellerName',
            'offers.status',
          ],
          query: {
            bool: {
              must: [
                {
                  bool: {
                    should: [
                      {
                        multi_match: {
                          query: q,
                          fields: [
                            'title^3',
                            'brand^2',
                            'category',
                            'manufacturerPartNumber^4',
                            'oeNumbers^2',
                          ],
                          type: 'best_fields',
                          fuzziness: 'AUTO',
                        },
                      },
                      {
                        term: {
                          'normalizedPartNumbers.keyword': {
                            value: normalized,
                            boost: 10,
                          },
                        },
                      },
                    ],
                    minimum_should_match: 1,
                  },
                },
              ],
              filter: [{ exists: { field: 'offers.sellerId' } }],
            },
          },
          aggs: {
            categories: {
              terms: { field: 'category.keyword', size: 4 },
            },
            brands: {
              terms: { field: 'brand.keyword', size: 4 },
            },
          },
        } as any,
      });

      const aggs: any = response.body.aggregations;

      // Apply the same buyer-visibility sanitization the regular search uses.
      // This drops parts whose only offers are from hidden/inactive sellers,
        // and recomputes minPrice from buyer-visible offers only.
      const sanitized = response.body.hits.hits
        .map((hit: any) => sanitizeSearchItem({ id: hit._id, ...hit._source }))
        .filter((item: any): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 6);

      const parts = sanitized.map((item: any) => {
        const currency =
          item.offers?.find((o: any) => o.currency)?.currency ?? null;
        return {
          id: item.id,
          title: item.title,
          brand: item.brand ?? null,
          category: item.category ?? null,
          imageUrl: item.imageUrls?.[0] ?? null,
          minPrice: item.minPrice ?? null,
          currency,
          manufacturerPartNumber: item.manufacturerPartNumber ?? null,
        };
      });

      // Only surface categories/brands that have at least one buyer-visible
      // part in the results, so clicking a suggestion never leads to an empty
      // results page.
      const visibleCats = new Set(
        parts.map((p) => p.category).filter(Boolean),
      );
      const visibleBrands = new Set(
        parts.map((p) => p.brand).filter(Boolean),
      );

      return {
        parts,
        categories: (aggs?.categories?.buckets || [])
          .map((b: any) => b.key as string)
          .filter((c: string) => visibleCats.has(c)),
        brands: (aggs?.brands?.buckets || [])
          .map((b: any) => b.key as string)
          .filter((b: string) => visibleBrands.has(b)),
      };
    } catch (error) {
      this.logger.error(`suggest failed for "${q}"`, error.stack);
      return { parts: [], categories: [], brands: [] };
    }
  }

  /** Distinct brand/category/make/part-type facets with counts, for the homepage. */
  async getFacets() {
    try {
      const response = await this.client.search({
        index: this.INDEX_NAME,
        body: {
          size: 0,
          aggs: {
            brands: { terms: { field: 'brand.keyword', size: 50 } },
            categories: { terms: { field: 'category.keyword', size: 50 } },
            makes: { terms: { field: 'makes.keyword', size: 50 } },
            partTypes: { terms: { field: 'partType.keyword', size: 50 } },
            sourceTags: { terms: { field: 'sourceTags.keyword', size: 50 } },
          },
        },
      });

      const aggs = (response.body.aggregations ?? {}) as {
        brands: FacetAgg;
        categories: FacetAgg;
        makes: FacetAgg;
        partTypes: FacetAgg;
        sourceTags: FacetAgg;
      };
      return {
        brands: bucketsOf(aggs.brands),
        categories: bucketsOf(aggs.categories),
        makes: bucketsOf(aggs.makes),
        partTypes: bucketsOf(aggs.partTypes),
        sourceTags: bucketsOf(aggs.sourceTags),
      };
    } catch (error) {
      this.logger.error('getFacets failed', error.stack);
      return { brands: [], categories: [], makes: [], partTypes: [] };
    }
  }
}

function emptyFacets(): BrowseFacets {
  return { brands: [], categories: [], makes: [], partTypes: [], sourceTags: [] };
}

/** Shape of a scoped `filter + terms` aggregation bucket list. */
type FacetAgg = {
  names?: { buckets?: Array<{ key: string; doc_count: number }> };
};

function bucketsOf(
  agg: FacetAgg | undefined,
): Array<{ name: string; count: number }> {
  return (agg?.names?.buckets ?? []).map((b) => ({
    name: b.key,
    count: b.doc_count,
  }));
}
