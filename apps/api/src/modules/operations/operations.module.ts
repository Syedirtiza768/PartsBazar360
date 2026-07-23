import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OperationsController } from './operations.controller';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { PricingModule } from '../pricing/pricing.module';
import { SellerOperationsController } from './sellers.controller';
import { PricingOperationsController } from './pricing.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ingestion',
    }),
    PricingModule,
  ],
  controllers: [OperationsController, SupportController, SellerOperationsController, PricingOperationsController],
  providers: [SupportService],
})
export class OperationsModule {}
