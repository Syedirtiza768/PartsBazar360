import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionProcessor } from './ingestion.processor';
import { MvlFitmentService } from './mvl-fitment.service';
import { IntegrationModule } from '../integration/integration.module';
import { SearchModule } from '../search/search.module';
import { PrismaService } from '../../prisma.service';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [
    IntegrationModule,
    SearchModule,
    PricingModule,
    BullModule.registerQueue({
      name: 'ingestion',
    }),
  ],
  providers: [IngestionProcessor, MvlFitmentService, PrismaService],
  exports: [MvlFitmentService],
})
export class IngestionModule {}
