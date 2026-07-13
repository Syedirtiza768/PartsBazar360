import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionProcessor } from './ingestion.processor';
import { IntegrationModule } from '../integration/integration.module';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    IntegrationModule,
    BullModule.registerQueue({
      name: 'ingestion',
    }),
  ],
  providers: [IngestionProcessor, PrismaService],
})
export class IngestionModule {}
