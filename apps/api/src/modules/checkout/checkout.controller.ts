import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CheckoutService } from './checkout.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CHARGE_CURRENCIES } from './currency.util';
import type { TamaraWebhookPayload } from './tamara.service';

class CheckoutDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsIn(['stripe', 'tamara'])
  paymentProvider?: 'stripe' | 'tamara';

  @IsObject()
  shippingAddress!: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsIn([...CHARGE_CURRENCIES])
  chargeCurrency?: string;
}

class ShippingQuoteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Shipping country is required' })
  country!: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsIn([...CHARGE_CURRENCIES])
  currency?: string;
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
      throw new BadRequestException(
        'Raw body unavailable for Stripe webhook verification',
      );
    }
    return this.checkoutService.handleStripeWebhook(rawBody, signature);
  }

  @Post('webhooks/tamara')
  tamaraWebhook(
    @Query('tamaraToken') queryToken: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: TamaraWebhookPayload,
  ) {
    const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    return this.checkoutService.handleTamaraWebhook(
      body,
      queryToken || bearerToken,
    );
  }

  @Post('payments/:paymentIntentId/confirm')
  confirmPayment(
    @Param('paymentIntentId') paymentIntentId: string,
    @Headers('x-payment-webhook-secret') webhookSecret: string | undefined,
    @Body() body: { status: 'SUCCEEDED' | 'FAILED'; externalId?: string },
  ) {
    return this.checkoutService.confirmPayment(
      paymentIntentId,
      body,
      webhookSecret,
    );
  }

  /** Authenticated checkout → Stripe hosted Checkout Session. */
  @Post(':cartId/shipping-quote')
  @UseGuards(JwtAuthGuard)
  shippingQuote(
    @Param('cartId') cartId: string,
    @Body() body: ShippingQuoteDto,
  ) {
    return this.checkoutService.quoteShipping(
      cartId,
      body.country,
      body.currency,
    );
  }

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
        phone: body.phone,
      },
      body.shippingAddress,
      body.chargeCurrency,
      body.paymentProvider,
    );
  }
}
