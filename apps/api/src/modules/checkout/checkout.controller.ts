import { Controller, Post, Body, Param } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post(':cartId')
  async checkout(
    @Param('cartId') cartId: string,
    @Body() body: { buyerId: string; shippingAddress: any }
  ) {
    return this.checkoutService.processCheckout(cartId, body.buyerId, body.shippingAddress);
  }
}
