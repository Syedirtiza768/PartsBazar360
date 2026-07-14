import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionProcessor } from './ingestion.processor';
import { IntegrationModule } from '../integration/integration.module';
import { SearchModule } from '../search/search.module';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    IntegrationModule,
    SearchModule,
    BullModule.registerQueue({
      name: 'ingestion',
    }),
  ],
  providers: [IngestionProcessor, PrismaService],
})
export class IngestionModule {}
