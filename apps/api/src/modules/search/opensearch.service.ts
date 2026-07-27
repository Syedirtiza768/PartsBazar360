import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { normalizePartNumber } from '../catalog-import/part-normalization.util';

@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private client: Client;
  private readonly INDEX_NAME = 'canonical_parts';

  onModuleInit() {
    this.client = new Client({
      node: process.env.OPENSEARCH_URL || 'http://localhost:9200',
    });
    this.logger.log('OpenSearch Service initialized');
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
          manufacturerPartNumber: part.manufacturerPartNumber || null,
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
          // Extract unique makes from compatibility data for faceted filtering.
          // Makes (Toyota, BMW) are vehicle manufacturers — distinct from brand
          // (FEBEST, Bosch) which is the parts manufacturer.
          makes: [...new Set(
            (part.compatibility || [])
              .map((c: any) => c.make)
              .filter(Boolean)
          )],
          oeNumbers: part.oeNumbers,
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
          })),
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
   * keyword search, brand/category filters, sorting and pagination.
   */
  async browseParts(opts: {
    q?: string;
    category?: string;
    brand?: string;
    make?: string;
    partType?: string;
    sort?: 'newest' | 'price_asc' | 'price_desc';
    page?: number;
    limit?: number;
    /**
     * Include interchange / analogue (OEM_CROSS_REFERENCE) numbers in a
     * part-number search. Default true — a buyer holding a superseded number
     * should find the part without knowing the concept "interchange". Turning
     * it off restricts matching to the part's own primary identity numbers.
     */
    includeInterchange?: boolean;
  }) {
    const {
      q,
      category,
      brand,
      make,
      partType,
      sort = 'newest',
      page = 1,
      limit = 24,
      includeInterchange = true,
    } = opts;

    // Named clauses (`_name`) so each hit reports *how* it matched via
    // `matched_queries`: a hit found only through an interchange number is
    // labelled as such rather than passed off as an exact match.
    const should: any[] = q
      ? [
          {
            multi_match: {
              query: q,
              fields: [
                'title^2',
                'brand',
                'category',
                'manufacturerPartNumber^2',
                'oeNumbers',
              ],
              _name: 'primary',
            },
          },
          {
            term: {
              'normalizedPartNumbers.keyword': {
                value: normalizePartNumber(q),
                _name: 'primary',
              },
            },
          },
        ]
      : [];

    // Interchange field is absent from indexes built before the catalog
    // normalization — matching it there simply yields no extra hits, so this
    // is safe to ship ahead of a reindex (no behaviour change until the field
    // is populated).
    if (q && includeInterchange) {
      should.push({
        term: {
          'interchangePartNumbers.keyword': {
            value: normalizePartNumber(q),
            _name: 'interchange',
          },
        },
      });
    }

    const must: any[] = q
      ? [{ bool: { should, minimum_should_match: 1 } }]
      : [{ match_all: {} }];

    const filter: any[] = [
      // Browse only parts that still have at least one indexed offer.
      { exists: { field: 'offers.sellerId' } },
    ];
    if (category) filter.push({ term: { 'category.keyword': category } });
    if (brand) filter.push({ term: { 'brand.keyword': brand } });
    if (make) filter.push({ term: { 'makes.keyword': make } });
    if (partType) filter.push({ term: { 'partType.keyword': partType } });

    const sortClause: any[] =
      sort === 'price_asc'
        ? [{ minPrice: { order: 'asc', missing: '_last' } }]
        : sort === 'price_desc'
          ? [{ minPrice: { order: 'desc', missing: '_last' } }]
          : [{ createdAt: { order: 'desc' } }];

    try {
      const response = await this.client.search({
        index: this.INDEX_NAME,
        body: {
          from: (page - 1) * limit,
          size: limit,
          query: { bool: { must, filter } },
          sort: sortClause,
        },
      });

      const totalRaw: any = response.body.hits.total;
      const total = typeof totalRaw === 'object' ? totalRaw.value : totalRaw;

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
        page,
        limit,
      };
    } catch (error) {
      this.logger.error('browseParts failed', error.stack);
      return { items: [], total: 0, page, limit };
    }
  }

  /**
   * Lightweight autocomplete suggestions. Returns the top matching parts,
   * categories, and brands for a partial query. Designed to be called on
   * every keystroke (debounced client-side) so it must be sub-100ms.
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
      const response = await this.client.search({
        index: this.INDEX_NAME,
        body: {
          size: 6,
          _source: [
            'id',
            'title',
            'brand',
            'category',
            'imageUrls',
            'minPrice',
            'manufacturerPartNumber',
            'offers.currency',
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
      const parts = response.body.hits.hits.map((hit: any) => {
        const src = hit._source;
        const currency =
          src.offers?.find((o: any) => o.currency)?.currency ?? null;
        return {
          id: src.id || hit._id,
          title: src.title,
          brand: src.brand ?? null,
          category: src.category ?? null,
          imageUrl: src.imageUrls?.[0] ?? null,
          minPrice: src.minPrice ?? null,
          currency,
          manufacturerPartNumber: src.manufacturerPartNumber ?? null,
        };
      });

      return {
        parts,
        categories: (aggs?.categories?.buckets || []).map(
          (b: any) => b.key as string,
        ),
        brands: (aggs?.brands?.buckets || []).map(
          (b: any) => b.key as string,
        ),
      };
    } catch (error) {
      this.logger.error(`suggest failed for "${q}"`, error.stack);
      return { parts: [], categories: [], brands: [] };
    }
  }

  /** Distinct brand/category facets with counts, for building filter sidebars. */
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
          },
        },
      });

      const aggs: any = response.body.aggregations;
      return {
        brands: (aggs?.brands?.buckets || []).map((b: any) => ({
          name: b.key,
          count: b.doc_count,
        })),
        categories: (aggs?.categories?.buckets || []).map((b: any) => ({
          name: b.key,
          count: b.doc_count,
        })),
        makes: (aggs?.makes?.buckets || []).map((b: any) => ({
          name: b.key,
          count: b.doc_count,
        })),
      };
    } catch (error) {
      this.logger.error('getFacets failed', error.stack);
      return { brands: [], categories: [], makes: [] };
    }
  }
}
