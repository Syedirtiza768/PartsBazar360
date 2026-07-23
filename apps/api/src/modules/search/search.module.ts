import { Module } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';
import { FebestWebsiteService } from './febest-website.service';
import { BuyerCacheService } from './buyer-cache.service';

@Module({
  providers: [OpenSearchService, FebestWebsiteService, BuyerCacheService],
  controllers: [SearchController],
  exports: [OpenSearchService, FebestWebsiteService, BuyerCacheService],
})
export class SearchModule {}
