import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionProcessor } from './ingestion.processor';
import { MvlFitmentService } from './mvl-fitment.service';
import { IntegrationModule } from '../integration/integration.module';
import { SearchModule } from '../search/search.module';
import { PricingModule } from '../pricing/pricing.module';

/**
 * When RUN_INGESTION_WORKER=1 (default for local/CLI), this process consumes
 * the BullMQ `ingestion` queue. The HTTP API container sets
 * RUN_INGESTION_WORKER=0 so request latency is not competed with sync jobs;
 * a dedicated `worker` compose service runs the processor instead.
 */
const runWorker = process.env.RUN_INGESTION_WORKER !== '0';

@Module({
  imports: [
    IntegrationModule,
    SearchModule,
    PricingModule,
    BullModule.registerQueue({
      name: 'ingestion',
    }),
  ],
  providers: [MvlFitmentService, ...(runWorker ? [IngestionProcessor] : [])],
  exports: [MvlFitmentService, ...(runWorker ? [IngestionProcessor] : [])],
})
export class IngestionModule {}
