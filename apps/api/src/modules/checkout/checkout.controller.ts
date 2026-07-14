import { Controller, Post, Body, Param } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  // Guest-friendly checkout — the buyer only needs to provide contact/shipping
  // details; we find-or-create a lightweight buyer record from the email so
  // orders can still be looked up later without requiring a full signup flow.
  @Post(':cartId')
  async checkout(
    @Param('cartId') cartId: string,
    @Body() body: { buyerId?: string; email?: string; name?: string; shippingAddress: any },
  ) {
    return this.checkoutService.processCheckout(cartId, body, body.shippingAddress);
  }
}
