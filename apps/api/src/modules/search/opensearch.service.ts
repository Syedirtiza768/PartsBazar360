import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { normalizePartNumber } from '../catalog-import/part-normalization.util';
import {
  applySuperiorPriority,
  sanitizeSearchItem,
} from './buyer-visible-offers.util';
import {
  sanitizeIdentifier,
  sanitizeIdentifierList,
} from './identifier-sanitize.util';
import { isCatalogHidden } from '@repo/catalog-contracts';
import {
  canonicalizeCatalogBrand,
  canonicalizeVehicleMakes,
  expandCatalogBrandFilterValues,
  expandVehicleMakeFilterValues,
} from '../catalog-import/catalog-identity.util';

export type BrowseSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';

export interface BrowseFacets {
  brands: Array<{ name: string; count: number }>;
  categories: Array<{ name: string; count: number }>;
  /**
   * Broader grouping over `categories` (e.g. "Transmission" over "Gearbox
   * Support", "Transmission Mounts"). Each group carries its own nested
   * category buckets so the sidebar can render group -> category hierarchy
   * from one aggregation instead of guessing a mapping client-side.
   */
  categoryGroups: Array<{
    name: string;
    count: number;
    categories: Array<{ name: string; count: number }>;
  }>;
  makes: Array<{ name: string; count: number }>;
  partTypes: Array<{ name: string; count: number }>;
  conditions: Array<{ name: string; count: number }>;
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
  /**
   * True when the requested page sits beyond the offset result window. The
   * response still carries the TRUE total (never a fake 0) so the UI can
   * recover to the last valid page instead of claiming the catalog is empty.
   */
  pageOutOfRange?: boolean;
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
            hasImage: { type: 'boolean' },
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
      categoryGroup: { type: 'keyword' },
      makes: { type: 'keyword' },
      oeNumbers: { type: 'keyword' },
      imageUrls: { type: 'keyword', index: false },
      // `imageUrls` is deliberately not indexed, so image availability cannot
      // be filtered or sorted on directly. This boolean is the queryable
      // projection of it, and is what lets browse float imaged listings to
      // the top of every result set.
      hasImage: { type: 'boolean' },
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
      conditions: { type: 'keyword' },
    };
  }

  async indexPart(part: any) {
    try {
      // Catalog-hidden parts (the payment-verification item) are removed
      // rather than indexed, so they never appear in any buyer-facing list
      // while remaining reachable by their own URL for checkout testing.
      if (isCatalogHidden(part)) {
        try {
          await this.client.delete({ index: this.INDEX_NAME, id: part.id });
        } catch {
          /* ignore missing */
        }
        return;
      }

      const rawOffers = Array.isArray(part.offers) ? part.offers : [];
      const visibleOffers = rawOffers.filter((o: any) => {
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
      // Superior takes priority over Blackline/Salvage on the same part. Doing
      // this before minPrice/sourceTags are derived keeps price sort, price
      // filters and the source-tag facet consistent with the rendered card.
      const offers = applySuperiorPriority(visibleOffers);

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
          brand: canonicalizeCatalogBrand(part.brand),
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
          categoryGroup: part.categoryGroup ?? null,
          // Extract unique makes from both compatibility data and any
          // explicit makes array passed by callers (e.g. from structured
          // fitments where the caller already resolved the make name).
          makes: [...new Set([
            ...(part.compatibility || [])
              .map((c: any) => c.make)
              .filter(Boolean),
            ...(part.makes || []).filter(Boolean),
          ].flatMap(canonicalizeVehicleMakes).filter(Boolean))],
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
          hasImage: Array.isArray(part.imageUrls) && part.imageUrls.length > 0,
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
          conditions: [...new Set(offers.map((o: any) => o.condition).filter(Boolean))],
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
          // Imaged listings first here too: a verified-fit result the buyer
          // cannot see a photo of is the least useful thing to lead with.
          // Lowest price still orders within each group. The trailing id
          // tiebreak keeps ties (same image flag + same price) in a stable
          // order across index refreshes, so items cannot duplicate or vanish
          // between pages.
          sort: [
            { hasImage: { order: 'desc', missing: '_last' } },
            { minPrice: { order: 'asc', missing: '_last' } },
            { id: { order: 'asc' } },
          ],
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
    categoryGroup?: string | string[];
    brand?: string | string[];
    make?: string | string[];
    partType?: string | string[];
    condition?: string | string[];
    sourceTag?: string | string[];
    minPrice?: number;
    maxPrice?: number;
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
    /** Count previews do not need the comparatively expensive facet aggregations. */
    includeFacets?: boolean;
  }): Promise<BrowseResult> {
    const {
      q,
      sort = 'relevance',
      page = 1,
      limit = 24,
      includeInterchange = true,
      includeFacets = true,
    } = opts;

    const pageNum = Math.max(1, Math.floor(page || 1));
    const size = Math.min(Math.max(1, Math.floor(limit || 24)), 200);
    const maxPage = Math.max(1, Math.floor(this.maxResultWindow / size));
    const hasQuery = !!(q && q.trim());

    const cats = asArray(opts.category);
    const groups = asArray(opts.categoryGroup);
    const brands = expandCatalogBrandFilterValues(asArray(opts.brand));
    const makes = expandVehicleMakeFilterValues(asArray(opts.make));
    const partTypes = asArray(opts.partType);
    const conditions = asArray(opts.condition);
    const sourceTags = asArray(opts.sourceTag);
    const minPrice =
      typeof opts.minPrice === 'number' && Number.isFinite(opts.minPrice)
        ? opts.minPrice
        : undefined;
    const maxPrice =
      typeof opts.maxPrice === 'number' && Number.isFinite(opts.maxPrice)
        ? opts.maxPrice
        : undefined;

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
    if (groups.length)
      baseFilters.push({ terms: { 'categoryGroup.keyword': groups } });
    if (brands.length) baseFilters.push({ terms: { 'brand.keyword': brands } });
    if (makes.length) baseFilters.push({ terms: { 'makes.keyword': makes } });
    if (partTypes.length)
      baseFilters.push({ terms: { 'partType.keyword': partTypes } });
    if (conditions.length)
      baseFilters.push({ terms: { 'conditions.keyword': conditions } });
    if (sourceTags.length)
      baseFilters.push({ terms: { 'sourceTags.keyword': sourceTags } });
    if (minPrice != null || maxPrice != null) {
      const priceRange: Record<string, number> = {};
      if (minPrice != null) priceRange.gte = minPrice;
      if (maxPrice != null) priceRange.lte = maxPrice;
      baseFilters.push({ range: { minPrice: priceRange } });
    }

    // --- sort. Relevance only means something for a keyword; a no-query
    //     browse falls back to newest so the feed is stable, not arbitrary. ---
    const useRelevance = sort === 'relevance' && hasQuery;

    /**
     * Listings with a photo come first in every browse ordering.
     *
     * A tile with no image converts far worse and looks broken, so an
     * imageless listing should never outrank an imaged one in a browse feed.
     * `missing: '_last'` matters during rollout: documents indexed before
     * `hasImage` existed have no value, and treating them as "no image" is
     * the safe reading — once the backfill lands they sort correctly.
     *
     * Within each group the buyer's chosen ordering is preserved exactly, so
     * a price sort is still a price sort — just imaged-first.
     */
    const imagesFirst = { hasImage: { order: 'desc', missing: '_last' } };

    // Final unique tiebreak on the indexed keyword `id`: without it, results
    // tied on score / price / createdAt at a page boundary can swap order
    // across segment merges, duplicating or dropping items between pages.
    const idTiebreak = { id: { order: 'asc' } };

    const sortClause: any[] = useRelevance
      ? // Deliberately NOT images-first: on a part-number query an exact
        // match must win even without a photo, or the search stops being
        // usable for the identifier lookups this catalogue exists to serve.
        // Image preference is applied as a score nudge instead (see the
        // `should` clause below) and as a tiebreaker here.
        [{ _score: { order: 'desc' } }, imagesFirst, { createdAt: { order: 'desc' } }, idTiebreak]
      : sort === 'price_asc'
        ? [imagesFirst, { minPrice: { order: 'asc', missing: '_last' } }, { createdAt: { order: 'desc' } }, idTiebreak]
        : sort === 'price_desc'
          ? [imagesFirst, { minPrice: { order: 'desc', missing: '_last' } }, { createdAt: { order: 'desc' } }, idTiebreak]
          : [imagesFirst, { createdAt: { order: 'desc' } }, idTiebreak];

    // --- scoped facets. Each dimension aggregates over every OTHER active
    //     filter (incl. the keyword), so counts answer "if I add this, how
    //     many results?" rather than the global total. ---
    const facetFilter = (exclude: string | string[]): any[] => {
      // category + categoryGroup are one conceptual dimension (a category
      // belongs to exactly one group) — excluding either alone would let a
      // selected category zero out every *other* group's count/nested
      // categories, trapping the buyer in whichever group their pick
      // happens to belong to. Both callers below exclude both together.
      const excluded = Array.isArray(exclude) ? exclude : [exclude];
      const skip = (field: string) => excluded.includes(field);
      const f: any[] = [{ exists: { field: 'offers.sellerId' } }];
      if (!skip('category') && cats.length)
        f.push({ terms: { 'category.keyword': cats } });
      if (!skip('categoryGroup') && groups.length)
        f.push({ terms: { 'categoryGroup.keyword': groups } });
      if (!skip('brand') && brands.length)
        f.push({ terms: { 'brand.keyword': brands } });
      if (!skip('make') && makes.length)
        f.push({ terms: { 'makes.keyword': makes } });
      if (!skip('partType') && partTypes.length)
        f.push({ terms: { 'partType.keyword': partTypes } });
      if (!skip('condition') && conditions.length)
        f.push({ terms: { 'conditions.keyword': conditions } });
      if (!skip('sourceTag') && sourceTags.length)
        f.push({ terms: { 'sourceTags.keyword': sourceTags } });
      if (!skip('price') && (minPrice != null || maxPrice != null)) {
        const priceRange: Record<string, number> = {};
        if (minPrice != null) priceRange.gte = minPrice;
        if (maxPrice != null) priceRange.lte = maxPrice;
        f.push({ range: { minPrice: priceRange } });
      }
      if (qClause) f.push(qClause);
      return f;
    };
    // Rebuilt per attempt: `facetFilter` closes over `qClause`, which the
    // relaxed retry below reassigns, and facet counts must describe the result
    // set the buyer is actually looking at.
    const buildAggs = () => ({
      categories: {
        filter: { bool: { filter: facetFilter(['category', 'categoryGroup']) } },
        aggs: { names: { terms: { field: 'category.keyword', size: 200, order: { _key: 'asc' } } } },
      },
      // Nested: each group bucket carries its own category sub-buckets, so
      // the sidebar can render group -> category hierarchy from one response
      // instead of guessing a category->group mapping client-side. Parts
      // with no categoryGroup (not yet covered by a categorization pass)
      // fall into "Other" rather than vanishing from the facet entirely.
      categoryGroups: {
        filter: { bool: { filter: facetFilter(['category', 'categoryGroup']) } },
        aggs: {
          names: {
            terms: { field: 'categoryGroup.keyword', size: 200, missing: 'Other', order: { _key: 'asc' } },
            aggs: {
              categories: { terms: { field: 'category.keyword', size: 200, order: { _key: 'asc' } } },
            },
          },
        },
      },
      brands: {
        filter: { bool: { filter: facetFilter('brand') } },
        aggs: { names: { terms: { field: 'brand.keyword', size: 200, order: { _key: 'asc' } } } },
      },
      makes: {
        filter: { bool: { filter: facetFilter('make') } },
        aggs: { names: { terms: { field: 'makes.keyword', size: 200, order: { _key: 'asc' } } } },
      },
      partTypes: {
        filter: { bool: { filter: facetFilter('partType') } },
        aggs: { names: { terms: { field: 'partType.keyword', size: 50, order: { _key: 'asc' } } } },
      },
      conditions: {
        filter: { bool: { filter: facetFilter('condition') } },
        aggs: { names: { terms: { field: 'conditions.keyword', size: 50, order: { _key: 'asc' } } } },
      },
      sourceTags: {
        filter: { bool: { filter: facetFilter('sourceTag') } },
        aggs: { names: { terms: { field: 'sourceTags.keyword', size: 50, order: { _key: 'asc' } } } },
      },
    });

    // Deep-page guard: from + size must stay inside max_result_window or
    // OpenSearch throws. Pages beyond the window return no items — but they
    // must still report the TRUE total (a cheap size:0 count) plus a
    // pageOutOfRange flag. Returning a fake total: 0 here made a hand-edited
    // or stale URL claim the whole catalog was empty ("No parts match").
    const from = (pageNum - 1) * size;
    if (from + size > this.maxResultWindow) {
      try {
        const countQuery = (clause: any | null) =>
          this.client.search({
            index: this.INDEX_NAME,
            body: {
              size: 0,
              track_total_hits: true,
              query: {
                bool: {
                  must: clause ? [clause] : [{ match_all: {} }],
                  filter: baseFilters,
                },
              },
            } as any,
          });
        const totalOf = (res: any) => {
          const t = res.body.hits.total;
          return typeof t === 'number' ? t : Number(t?.value || 0);
        };
        let countRes = await countQuery(qClause);
        let total = totalOf(countRes);
        let relaxed = false;
        // Same relaxation rule as in-window pages: a query whose strict set is
        // empty reports its relaxed total, so a deep relaxed URL agrees with
        // page 1 instead of contradicting it.
        if (hasQuery && total === 0) {
          const relaxedClause = buildQClause('relaxed');
          countRes = await countQuery(relaxedClause);
          total = totalOf(countRes);
          relaxed = true;
        }
        return {
          items: [],
          total,
          totalRelation: 'eq',
          page: pageNum,
          limit: size,
          maxPage,
          facets: emptyFacets(),
          ...(relaxed ? { relaxed } : {}),
          pageOutOfRange: true,
        };
      } catch (error) {
        this.logger.error('browseParts out-of-range count failed', error.stack);
        return {
          items: [],
          total: 0,
          totalRelation: 'eq',
          page: pageNum,
          limit: size,
          maxPage,
          facets: emptyFacets(),
          pageOutOfRange: true,
        };
      }
    }

    try {
      const runSearch = () =>
        this.client.search({
          index: this.INDEX_NAME,
          body: {
            from,
            size,
            track_total_hits: true,
            query: {
              bool: {
                must,
                filter: baseFilters,
                // Score-only preference for listings with a photo. This sits
                // in the OUTER bool, where `should` alongside a `must`
                // contributes to score without widening the match set — the
                // same clause inside `buildQClause`'s bool would satisfy its
                // `minimum_should_match: 1` and make every imaged listing
                // match every query.
                //
                // The boost is small on purpose: it separates otherwise
                // comparable results without ever outranking an exact
                // part-number hit, which scores ~60.
                should: [{ term: { hasImage: { value: true, boost: 2 } } }],
              },
            },
            sort: sortClause,
            ...(includeFacets ? { aggs: buildAggs() } : {}),
          } as any,
        });

      let response = await runSearch();
      let relaxed = false;

      // Strict matching is right when the catalogue has the part and wrong when
      // it does not — "front bumper for 2018 Audi Q7" would return an empty
      // page rather than close alternatives. An empty strict result set is
      // retried relaxed on EVERY page: relaxing only page 1 made page 1 report
      // the relaxed total while page 2+ re-ran the strict query, returned
      // total 0, and rendered "No matching parts" one click after showing
      // thousands of related parts.
      //
      // Only a genuinely empty result set triggers the retry. Padding a thin
      // one is worse than leaving it thin: a pasted part number legitimately
      // returns a single hit, and treating that as "no exact matches, showing
      // related parts" mislabels a perfect match as a failure. `hits.total` is
      // page-independent, so the strict check is just as accurate on deep
      // pages as on page 1.
      if (hasQuery) {
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
        string,
        FacetAgg | GroupFacetAgg
      >;
      const facets: BrowseFacets = includeFacets
        ? {
            categories: bucketsOf(aggsBody.categories as FacetAgg, 'category'),
            categoryGroups: bucketsOfGroups(aggsBody.categoryGroups as GroupFacetAgg),
            brands: bucketsOf(aggsBody.brands as FacetAgg, 'brand'),
            makes: bucketsOf(aggsBody.makes as FacetAgg, 'make'),
            partTypes: bucketsOf(aggsBody.partTypes as FacetAgg, 'partType'),
            conditions: bucketsOf(aggsBody.conditions as FacetAgg, 'condition'),
            sourceTags: bucketsOf(aggsBody.sourceTags as FacetAgg, 'sourceTag'),
          }
        : emptyFacets();

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
    categoryGroups: string[];
    brands: string[];
    makes: string[];
    sourceTags: string[];
  }> {
    try {
      const normalized = normalizePartNumber(q);
      const numberish = /\d/.test(normalized) && normalized.length >= 4;
      const textClauses: any[] = [
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
            minimum_should_match: numberish ? '100%' : '2<75%',
          },
        },
      ];
      if (!numberish && q.trim().length >= 4) {
        textClauses.push({
          match_phrase_prefix: {
            title: {
              query: q,
              boost: 2,
              max_expansions: 20,
            },
          },
        });
      }
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
                      ...textClauses,
                      {
                        term: {
                          'normalizedPartNumbers.keyword': {
                            value: normalized,
                            boost: 80,
                          },
                        },
                      },
                      {
                        term: {
                          'interchangePartNumbers.keyword': {
                            value: normalized,
                            boost: 45,
                          },
                        },
                      },
                      {
                        term: {
                          'oeNumbers.keyword': {
                            value: normalized,
                            boost: 60,
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
              terms: { field: 'category.keyword', size: 6, order: { _key: 'asc' } },
            },
            categoryGroups: {
              terms: { field: 'categoryGroup.keyword', size: 6, order: { _key: 'asc' } },
            },
            brands: {
              terms: { field: 'brand.keyword', size: 6, order: { _key: 'asc' } },
            },
            makes: {
              terms: { field: 'makes.keyword', size: 6, order: { _key: 'asc' } },
            },
            sourceTags: {
              terms: { field: 'sourceTags.keyword', size: 6, order: { _key: 'asc' } },
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

      return {
        parts,
        categories: bucketsOf(aggs?.categories, 'category').map((b) => b.name).slice(0, 6),
        categoryGroups: bucketsOf(aggs?.categoryGroups, 'categoryGroup').map((b) => b.name).slice(0, 6),
        brands: bucketsOf(aggs?.brands, 'brand').map((b) => b.name).slice(0, 6),
        makes: bucketsOf(aggs?.makes, 'make').map((b) => b.name).slice(0, 6),
        sourceTags: bucketsOf(aggs?.sourceTags, 'sourceTag').map((b) => b.name).slice(0, 6),
      };
    } catch (error) {
      this.logger.error(`suggest failed for "${q}"`, error.stack);
      return {
        parts: [],
        categories: [],
        categoryGroups: [],
        brands: [],
        makes: [],
        sourceTags: [],
      };
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
            brands: { terms: { field: 'brand.keyword', size: 200, order: { _key: 'asc' } } },
            categories: { terms: { field: 'category.keyword', size: 200, order: { _key: 'asc' } } },
            categoryGroups: {
              terms: { field: 'categoryGroup.keyword', size: 200, missing: 'Other', order: { _key: 'asc' } },
              aggs: {
                categories: { terms: { field: 'category.keyword', size: 200, order: { _key: 'asc' } } },
              },
            },
            makes: { terms: { field: 'makes.keyword', size: 200, order: { _key: 'asc' } } },
            partTypes: { terms: { field: 'partType.keyword', size: 50, order: { _key: 'asc' } } },
            conditions: { terms: { field: 'conditions.keyword', size: 50, order: { _key: 'asc' } } },
            sourceTags: { terms: { field: 'sourceTags.keyword', size: 50, order: { _key: 'asc' } } },
          },
        },
      });

      const aggs = (response.body.aggregations ?? {}) as {
        brands: FacetAgg;
        categories: FacetAgg;
        categoryGroups: { buckets?: Array<{ key: string; doc_count: number; categories?: { buckets?: Array<{ key: string; doc_count: number }> } }> };
        makes: FacetAgg;
        partTypes: FacetAgg;
        conditions: FacetAgg;
        sourceTags: FacetAgg;
      };
      return {
        brands: bucketsOf(aggs.brands, 'brand'),
        categories: bucketsOf(aggs.categories, 'category'),
        categoryGroups: bucketsOfGroups({ names: aggs.categoryGroups }),
        makes: bucketsOf(aggs.makes, 'make'),
        partTypes: bucketsOf(aggs.partTypes, 'partType'),
        conditions: bucketsOf(aggs.conditions, 'condition'),
        sourceTags: bucketsOf(aggs.sourceTags, 'sourceTag'),
      };
    } catch (error) {
      this.logger.error('getFacets failed', error.stack);
      return {
        brands: [],
        categories: [],
        categoryGroups: [],
        makes: [],
        partTypes: [],
        conditions: [],
        sourceTags: [],
      };
    }
  }
}

function emptyFacets(): BrowseFacets {
  return {
    brands: [],
    categories: [],
    categoryGroups: [],
    makes: [],
    partTypes: [],
    conditions: [],
    sourceTags: [],
  };
}

/** Shape of a scoped `filter + terms` aggregation bucket list. */
type FacetAgg = {
  names?: { buckets?: Array<{ key: string; doc_count: number }> };
  buckets?: Array<{ key: string; doc_count: number }>;
};

function bucketsOf(
  agg: FacetAgg | undefined,
  field: FacetFieldName = 'generic',
): Array<{ name: string; count: number }> {
  return mergeFacetBuckets(agg?.names?.buckets ?? agg?.buckets ?? [], field);
}

/** Shape of a scoped `filter + terms` agg whose buckets nest a sub-terms agg. */
type GroupFacetAgg = {
  names?: {
    buckets?: Array<{
      key: string;
      doc_count: number;
      categories?: { buckets?: Array<{ key: string; doc_count: number }> };
    }>;
  };
  buckets?: Array<{
    key: string;
    doc_count: number;
    categories?: { buckets?: Array<{ key: string; doc_count: number }> };
  }>;
};

function bucketsOfGroups(
  agg: GroupFacetAgg | undefined,
): Array<{
  name: string;
  count: number;
  categories: Array<{ name: string; count: number }>;
}> {
  return (agg?.names?.buckets ?? agg?.buckets ?? [])
    .map((b) => ({
      name: String(b.key),
      count: b.doc_count,
      categories: mergeFacetBuckets(b.categories?.buckets ?? [], 'category'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function facetKey(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

type FacetFieldName =
  | 'brand'
  | 'category'
  | 'categoryGroup'
  | 'condition'
  | 'generic'
  | 'make'
  | 'partType'
  | 'sourceTag';

function cleanFacetNames(name: string, field: FacetFieldName): string[] {
  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (!cleaned) return [];
  if (field === 'make') return canonicalizeVehicleMakes(cleaned);
  if (field === 'brand') {
    const brand = canonicalizeCatalogBrand(cleaned);
    return brand ? [brand] : [];
  }
  return [cleaned];
}

function preferDisplayName(current: string, next: string): string {
  if (!current) return next;
  const currentHasLower = /[a-z]/.test(current);
  const nextHasLower = /[a-z]/.test(next);
  if (nextHasLower && !currentHasLower) return next;
  if (current === current.toLocaleLowerCase() && next !== next.toLocaleLowerCase()) {
    return next;
  }
  if (next.length < current.length && next.toLocaleUpperCase() === current.toLocaleUpperCase()) {
    return next;
  }
  return current;
}

function mergeFacetBuckets(
  buckets: Array<{ key: string; doc_count: number }>,
  field: FacetFieldName = 'generic',
): Array<{ name: string; count: number }> {
  const merged = new Map<string, { name: string; count: number }>();
  for (const bucket of buckets) {
    for (const name of cleanFacetNames(String(bucket.key ?? ''), field)) {
      const key = facetKey(name);
      const existing = merged.get(key);
      if (existing) {
        existing.name = preferDisplayName(existing.name, name);
        existing.count += bucket.doc_count;
      } else {
        merged.set(key, { name, count: bucket.doc_count });
      }
    }
  }
  return [...merged.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}
