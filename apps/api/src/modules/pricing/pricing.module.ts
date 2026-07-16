import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PricingService } from './pricing.service';

@Module({
  providers: [PrismaService, PricingService],
  exports: [PricingService],
})
export class PricingModule {}

