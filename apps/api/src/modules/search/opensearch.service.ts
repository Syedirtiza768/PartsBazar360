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
      const minPrice = Array.isArray(part.offers) && part.offers.length > 0
        ? Math.min(...part.offers.map((o: any) => o.price ?? Infinity))
        : null;

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
            .filter((number: any) => number.numberType !== 'OEM_CROSS_REFERENCE')
            .map((number: any) => number.normalizedNumber)
            .filter(Boolean),
          category: part.category,
          oeNumbers: part.oeNumbers,
          // Split part numbers by role so search can offer an interchange
          // toggle. `normalizedPartNumbers` stays primary-identity only
          // (OEM / MPN / genuine) — it is what a "this exact part" match uses.
          // Interchange / analogue numbers (OEM_CROSS_REFERENCE) go in their
          // own field so they can be included or excluded per query and, when
          // they match, labelled as an interchange hit rather than an exact one.
          interchangePartNumbers: (part.partNumbers || [])
            .filter((number: any) => number.numberType === 'OEM_CROSS_REFERENCE')
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
          minPrice,
          // Only structured, high-confidence evidence can power a green "fits"
          // result. Title-inferred D-level matches remain available on the PDP
          // as advisory compatibility and never enter guaranteed-fit search.
          fitments: (part.fitments || [])
            .filter((f: any) => ['A', 'B'].includes(f.evidenceLevel) && Number(f.confidence) >= 0.8)
            .map((f: any) => f.vehicleConfigId),
          offers: (part.offers || []).map((o: any) => ({
            id: o.id,
            price: o.price,
            // Currency must travel with the price — cards previously assumed
            // USD for indexed offers while the PDP showed the real currency.
            currency: o.currency || null,
            condition: o.condition,
            partSource: o.partSource || null,
            qualityTier: o.qualityTier || null,
            sellerId: o.sellerId,
            sellerName: o.sellerName || null,
          })),
        },
        refresh: true,
      });
      this.logger.log(`Indexed part ${part.id} into OpenSearch`);
    } catch (error) {
      this.logger.error(`Failed to index part ${part.id}`, error.stack);
    }
  }

  async searchCompatibleParts(vehicleConfigId: string, query?: string) {
    try {
      const must: any[] = [
        { term: { 'fitments.keyword': vehicleConfigId } }
      ];

      if (query) {
        must.push({ bool: { should: [
          { multi_match: { query, fields: ['title', 'brand', 'category', 'manufacturerPartNumber', 'oeNumbers'] } },
          { term: { 'normalizedPartNumbers.keyword': normalizePartNumber(query) } },
        ], minimum_should_match: 1 } });
      }

      const response = await this.client.search({
        index: this.INDEX_NAME,
        body: {
          size: 200,
          query: {
            bool: {
              must
            }
          },
          sort: [{ minPrice: { order: 'asc', missing: '_last' } }],
        } as any,
      });

      return response.body.hits.hits.map((hit: any) => ({ id: hit._id, ...(hit._source as object) }));
    } catch (error) {
      this.logger.error(`Search failed for vehicleConfigId ${vehicleConfigId}`, error.stack);
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
    const { q, category, brand, partType, sort = 'newest', page = 1, limit = 24, includeInterchange = true } = opts;

    // Named clauses (`_name`) so each hit reports *how* it matched via
    // `matched_queries`: a hit found only through an interchange number is
    // labelled as such rather than passed off as an exact match.
    const should: any[] = q
      ? [
          { multi_match: { query: q, fields: ['title^2', 'brand', 'category', 'manufacturerPartNumber^2', 'oeNumbers'], _name: 'primary' } },
          { term: { 'normalizedPartNumbers.keyword': { value: normalizePartNumber(q), _name: 'primary' } } },
        ]
      : [];

    // Interchange field is absent from indexes built before the catalog
    // normalization — matching it there simply yields no extra hits, so this
    // is safe to ship ahead of a reindex (no behaviour change until the field
    // is populated).
    if (q && includeInterchange) {
      should.push({ term: { 'interchangePartNumbers.keyword': { value: normalizePartNumber(q), _name: 'interchange' } } });
    }

    const must: any[] = q
      ? [{ bool: { should, minimum_should_match: 1 } }]
      : [{ match_all: {} }];

    const filter: any[] = [];
    if (category) filter.push({ term: { 'category.keyword': category } });
    if (brand) filter.push({ term: { 'brand.keyword': brand } });
    if (partType) filter.push({ term: { 'partType.keyword': partType } });

    const sortClause: any[] =
      sort === 'price_asc' ? [{ minPrice: { order: 'asc', missing: '_last' } }] :
      sort === 'price_desc' ? [{ minPrice: { order: 'desc', missing: '_last' } }] :
      [{ createdAt: { order: 'desc' } }];

    try {
      const response = await this.client.search({
        index: this.INDEX_NAME,
        body: {
          from: (page - 1) * limit,
          size: limit,
          query: { bool: { must, filter } },
          sort: sortClause,
        } as any,
      });

      const totalRaw: any = response.body.hits.total;
      const total = typeof totalRaw === 'object' ? totalRaw.value : totalRaw;

      return {
        items: response.body.hits.hits.map((hit: any) => {
          // A hit that matched an interchange number but NOT a primary one was
          // found via a cross-reference — tell the buyer so, and echo back the
          // number they searched so the card can name it.
          const matched: string[] = hit.matched_queries || [];
          const viaInterchange = matched.includes('interchange') && !matched.includes('primary');
          return {
            id: hit._id,
            ...(hit._source as object),
            ...(viaInterchange ? { matchedVia: 'interchange', matchedNumber: q } : {}),
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
          },
        },
      });

      const aggs: any = response.body.aggregations;
      return {
        brands: (aggs?.brands?.buckets || []).map((b: any) => ({ name: b.key, count: b.doc_count })),
        categories: (aggs?.categories?.buckets || []).map((b: any) => ({ name: b.key, count: b.doc_count })),
      };
    } catch (error) {
      this.logger.error('getFacets failed', error.stack);
      return { brands: [], categories: [] };
    }
  }
}
