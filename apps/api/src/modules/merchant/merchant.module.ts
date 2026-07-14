import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { OrdersController } from './orders.controller';
import { AnalyticsController } from './analytics.controller';
import { UploadsController } from './uploads.controller';
import { MerchantUploadsService } from './uploads.service';
import { PrismaService } from '../../prisma.service';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [SearchModule],
  controllers: [InventoryController, OrdersController, AnalyticsController, UploadsController],
  providers: [PrismaService, MerchantUploadsService],
})
export class MerchantModule {}
