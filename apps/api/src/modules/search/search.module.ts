import { Module } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';
import { FebestWebsiteService } from './febest-website.service';
import { BuyerCacheService } from './buyer-cache.service';
import { MvlOeCatalogService } from './mvl-oe-catalog.service';
import { SearchV1Service } from './v1/search-v1.service';
import { SearchV1Controller } from './v1/search-v1.controller';
import { SearchIndexerService } from './index/search-indexer.service';
import { SearchOutboxService } from './index/search-outbox.service';
import { SearchOutboxRunner } from './index/search-outbox.runner';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { CheckoutModule } from '../checkout/checkout.module';

@Module({
  imports: [EnrichmentModule, CheckoutModule],
  providers: [
    OpenSearchService,
    FebestWebsiteService,
    BuyerCacheService,
    MvlOeCatalogService,
    SearchV1Service,
    SearchIndexerService,
    SearchOutboxService,
    // Only ticks where RUN_SEARCH_OUTBOX_WORKER is enabled (the worker
    // process), so the API does not compete for the same outbox rows.
    SearchOutboxRunner,
  ],
  // SearchV1Controller is additive: the existing /search/* routes are
  // untouched so the current buyer app keeps working during rollout.
  controllers: [SearchController, SearchV1Controller],
  exports: [
    OpenSearchService,
    FebestWebsiteService,
    BuyerCacheService,
    MvlOeCatalogService,
    SearchV1Service,
    SearchIndexerService,
    SearchOutboxService,
  ],
})
export class SearchModule {}
