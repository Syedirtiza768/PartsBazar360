import { Module } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';
import { FebestWebsiteService } from './febest-website.service';
import { BuyerCacheService } from './buyer-cache.service';
import { MvlOeCatalogService } from './mvl-oe-catalog.service';

@Module({
  providers: [
    OpenSearchService,
    FebestWebsiteService,
    BuyerCacheService,
    MvlOeCatalogService,
  ],
  controllers: [SearchController],
  exports: [
    OpenSearchService,
    FebestWebsiteService,
    BuyerCacheService,
    MvlOeCatalogService,
  ],
})
export class SearchModule {}
