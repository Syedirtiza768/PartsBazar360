import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentBudgetService } from './enrichment-budget.service';
import { EnrichmentProcessor } from './enrichment.processor';
import { BuyerCacheService } from '../search/buyer-cache.service';

/**
 * AI enrichment of shipping metrics.
 *
 * The HTTP API container only enqueues (RUN_ENRICHMENT_WORKER=0); the dedicated
 * `worker` service consumes the queue, so an OpenRouter call can never sit in
 * front of a buyer's request. Mirrors the IngestionModule split.
 */
const runWorker = process.env.RUN_ENRICHMENT_WORKER !== '0';

@Module({
  imports: [BullModule.registerQueue({ name: 'enrichment' })],
  providers: [
    EnrichmentService,
    EnrichmentBudgetService,
    // Provided directly rather than by importing SearchModule: SearchModule
    // depends on EnrichmentService, and BuyerCacheService is stateless.
    BuyerCacheService,
    ...(runWorker ? [EnrichmentProcessor] : []),
  ],
  exports: [EnrichmentService, EnrichmentBudgetService],
})
export class EnrichmentModule {}
