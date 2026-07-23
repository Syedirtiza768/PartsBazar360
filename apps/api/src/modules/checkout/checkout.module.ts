import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { ShippingService } from './shipping.service';
import { StripeService } from './stripe.service';
import { CartModule } from '../cart/cart.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderModule } from '../order/order.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [CartModule, InventoryModule, OrderModule, AuthModule],
  providers: [CheckoutService, ShippingService, StripeService],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
