import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentLinkController } from './payment-link.controller';
import { PaymentLinkService } from './payment-link.service';

@Module({
  imports: [AuthModule, AuditModule, CheckoutModule],
  controllers: [PaymentLinkController],
  providers: [PaymentLinkService],
})
export class PaymentLinkModule {}
