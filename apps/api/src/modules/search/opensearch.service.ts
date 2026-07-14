import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';

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
          brand: part.brand,
          category: part.category,
          oeNumbers: part.oeNumbers,
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
          fitments: (part.fitments || []).map((f: any) => f.vehicleConfigId),
          offers: (part.offers || []).map((o: any) => ({
            id: o.id,
            price: o.price,
            condition: o.condition,
            partSource: o.partSource || null,
            qualityTier: o.qualityTier || null,
            sellerId: o.sellerId,
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
        must.push({
          multi_match: {
            query,
            fields: ['title', 'brand', 'category']
          }
        });
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
    sort?: 'newest' | 'price_asc' | 'price_desc';
    page?: number;
    limit?: number;
  }) {
    const { q, category, brand, sort = 'newest', page = 1, limit = 24 } = opts;

    const must: any[] = q
      ? [{ multi_match: { query: q, fields: ['title^2', 'brand', 'category', 'oeNumbers'] } }]
      : [{ match_all: {} }];

    const filter: any[] = [];
    if (category) filter.push({ term: { 'category.keyword': category } });
    if (brand) filter.push({ term: { 'brand.keyword': brand } });

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
        items: response.body.hits.hits.map((hit: any) => ({ id: hit._id, ...(hit._source as object) })),
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
