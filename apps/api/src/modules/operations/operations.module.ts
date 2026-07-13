import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OperationsController } from './operations.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ingestion',
    }),
  ],
  controllers: [OperationsController],
})
export class OperationsModule {}
