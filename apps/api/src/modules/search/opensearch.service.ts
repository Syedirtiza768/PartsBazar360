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
      await this.client.index({
        index: this.INDEX_NAME,
        id: part.id,
        body: {
          title: part.title,
          brand: part.brand,
          category: part.category,
          fitments: part.fitments.map(f => f.vehicleConfigId),
          offers: part.offers.map(o => ({
            id: o.id,
            price: o.price,
            condition: o.condition,
            sellerId: o.sellerId,
          }))
        },
        refresh: true, // Force refresh for MVP visibility
      });
      this.logger.log(`Indexed part ${part.id} into OpenSearch`);
    } catch (error) {
      this.logger.error(`Failed to index part ${part.id}`, error.stack);
    }
  }

  async searchCompatibleParts(vehicleConfigId: string, query?: string) {
    try {
      const must: any[] = [
        { term: { fitments: vehicleConfigId } }
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
          query: {
            bool: {
              must
            }
          }
        }
      });

      return response.body.hits.hits.map(hit => hit._source);
    } catch (error) {
      this.logger.error(`Search failed for vehicleConfigId ${vehicleConfigId}`, error.stack);
      throw error;
    }
  }
}
