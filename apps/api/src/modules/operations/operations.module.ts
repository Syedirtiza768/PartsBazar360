import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OperationsController } from './operations.controller';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { PricingModule } from '../pricing/pricing.module';
import { SellerOperationsController } from './sellers.controller';
import { PricingOperationsController } from './pricing.controller';
import { AuthModule } from '../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ingestion',
    }),
    PricingModule,
    AuthModule,
    OrderModule,
    CheckoutModule,
    AuditModule,
  ],
  controllers: [
    OperationsController,
    SupportController,
    SellerOperationsController,
    PricingOperationsController,
  ],
  providers: [SupportService],
})
export class OperationsModule {}
