import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IntegrationModule } from './modules/integration/integration.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { OperationsModule } from './modules/operations/operations.module';
import { VehicleModule } from './modules/vehicle/vehicle.module';
import { GarageModule } from './modules/garage/garage.module';
import { SearchModule } from './modules/search/search.module';
import { CartModule } from './modules/cart/cart.module';
import { OrderModule } from './modules/order/order.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { CatalogImportModule } from './modules/catalog-import/catalog-import.module';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    IntegrationModule,
    IngestionModule,
    OperationsModule,
    VehicleModule,
    GarageModule,
    SearchModule,
    CartModule,
    OrderModule,
    CheckoutModule,
    MerchantModule,
    CatalogImportModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}