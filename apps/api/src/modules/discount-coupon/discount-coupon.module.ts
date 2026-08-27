import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { DiscountCouponController } from './discount-coupon.controller';
import { DiscountCouponService } from './discount-coupon.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [DiscountCouponController],
  providers: [DiscountCouponService],
})
export class DiscountCouponModule {}
