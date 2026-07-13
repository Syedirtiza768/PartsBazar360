import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { ShippingService } from './shipping.service';
import { CartModule } from '../cart/cart.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderModule } from '../order/order.module';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [CartModule, InventoryModule, OrderModule],
  providers: [CheckoutService, ShippingService, PrismaService],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
