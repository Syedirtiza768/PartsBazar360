import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentBudgetService } from './enrichment-budget.service';
import { EnrichmentProcessor } from './enrichment.processor';
import { AdminEnrichmentController } from './admin-enrichment.controller';
import { BuyerCacheService } from '../search/buyer-cache.service';
import { IntegrationModule } from '../integration/integration.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Listing enrichment.
 *
 * Default provider: RealTrack trading-enrichment (item specifics + shipping).
 * Optional AI diagrams for high-value parts still run in the worker when
 * OPENROUTER_API_KEY is set. The HTTP API only enqueues.
 */
const runWorker = process.env.RUN_ENRICHMENT_WORKER !== '0';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'enrichment' }),
    IntegrationModule,
    AuthModule,
  ],
  controllers: [AdminEnrichmentController],
  providers: [
    EnrichmentService,
    EnrichmentBudgetService,
    BuyerCacheService,
    ...(runWorker ? [EnrichmentProcessor] : []),
  ],
  exports: [EnrichmentService, EnrichmentBudgetService],
})
export class EnrichmentModule {}
