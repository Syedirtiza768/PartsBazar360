import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CheckoutService } from './checkout.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

class CheckoutDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsObject()
  shippingAddress!: Record<string, unknown>;
}

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  /** Stripe-hosted Checkout webhook — card data never touches our servers. */
  @Post('webhooks/stripe')
  stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Raw body unavailable for Stripe webhook verification');
    }
    return this.checkoutService.handleStripeWebhook(rawBody, signature);
  }

  @Post('payments/:paymentIntentId/confirm')
  confirmPayment(
    @Param('paymentIntentId') paymentIntentId: string,
    @Headers('x-payment-webhook-secret') webhookSecret: string | undefined,
    @Body() body: { status: 'SUCCEEDED' | 'FAILED'; externalId?: string },
  ) {
    return this.checkoutService.confirmPayment(paymentIntentId, body, webhookSecret);
  }

  /** Authenticated checkout → Stripe hosted Checkout Session. */
  @Post(':cartId')
  @UseGuards(JwtAuthGuard)
  async checkout(
    @Param('cartId') cartId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CheckoutDto,
  ) {
    return this.checkoutService.processCheckout(
      cartId,
      {
        buyerId: user.userId,
        email: user.email,
        name: body.name,
      },
      body.shippingAddress,
    );
  }
}
