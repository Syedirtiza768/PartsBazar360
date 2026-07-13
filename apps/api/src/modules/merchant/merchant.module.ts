import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { OrdersController } from './orders.controller';
import { AnalyticsController } from './analytics.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [InventoryController, OrdersController, AnalyticsController],
  providers: [PrismaService],
})
export class MerchantModule {}
