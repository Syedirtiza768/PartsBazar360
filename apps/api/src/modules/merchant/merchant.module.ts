import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { OrdersController } from './orders.controller';
import { AnalyticsController } from './analytics.controller';
import { UploadsController } from './uploads.controller';
import { MerchantUploadsService } from './uploads.service';
import { PrismaService } from '../../prisma.service';
import { SearchModule } from '../search/search.module';
import { PricingModule } from '../pricing/pricing.module';
import { SellerOnboardingController } from './onboarding.controller';
import { SellerOnboardingService } from './onboarding.service';
import { MerchantPricingController } from './pricing.controller';
import { CatalogImportModule } from '../catalog-import/catalog-import.module';

@Module({
  imports: [SearchModule, PricingModule, CatalogImportModule],
  controllers: [
    InventoryController,
    OrdersController,
    AnalyticsController,
    UploadsController,
    SellerOnboardingController,
    MerchantPricingController,
  ],
  providers: [PrismaService, MerchantUploadsService, SellerOnboardingService],
})
export class MerchantModule {}
