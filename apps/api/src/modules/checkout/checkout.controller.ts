import { Controller, Post, Body, Param, Headers } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('payments/:paymentIntentId/confirm')
  confirmPayment(
    @Param('paymentIntentId') paymentIntentId: string,
    @Headers('x-payment-webhook-secret') webhookSecret: string | undefined,
    @Body() body: { status: 'SUCCEEDED' | 'FAILED'; externalId?: string },
  ) {
    return this.checkoutService.confirmPayment(paymentIntentId, body, webhookSecret);
  }

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
