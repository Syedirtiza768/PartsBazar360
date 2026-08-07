import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CheckoutService } from './checkout.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CHARGE_CURRENCIES } from './currency.util';
import type { TamaraWebhookPayload } from './tamara.service';
import { CheckoutIdentityService } from './checkout-identity.service';

class CheckoutDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

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

class CheckoutSessionDto {
  @IsOptional()
  @IsObject()
  draft?: Record<string, unknown>;
}

class CheckoutDraftDto {
  @IsObject()
  draft!: Record<string, unknown>;
}

class RequestCheckoutOtpDto {
  @IsString()
  phone!: string;
}

class VerifyCheckoutOtpDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

class CreateCheckoutAccountDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

class CheckoutEventDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  checkoutSessionId?: string;

  @IsOptional()
  @IsString()
  deviceClass?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean>;
}

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly identity: CheckoutIdentityService,
    private readonly auth: AuthService,
  ) {}

  @Post(':cartId/session')
  createCheckoutSession(
    @Param('cartId') cartId: string,
    @Body() body: CheckoutSessionDto,
  ) {
    return this.identity.createSession(cartId, body.draft);
  }

  @Patch('sessions/:sessionId/draft')
  updateCheckoutDraft(
    @Param('sessionId') sessionId: string,
    @Body() body: CheckoutDraftDto,
  ) {
    return this.identity.updateDraft(sessionId, body.draft);
  }

  @Post('sessions/:sessionId/phone/send')
  requestCheckoutOtp(
    @Param('sessionId') sessionId: string,
    @Body() body: RequestCheckoutOtpDto,
    @Req() request: Request,
  ) {
    return this.identity.requestOtp(
      sessionId,
      body.phone,
      request.ip,
      Array.isArray(request.headers['user-agent'])
        ? request.headers['user-agent'][0]
        : request.headers['user-agent'],
    );
  }

  @Post('sessions/:sessionId/phone/verify')
  verifyCheckoutOtp(
    @Param('sessionId') sessionId: string,
    @Body() body: VerifyCheckoutOtpDto,
  ) {
    return this.identity.verifyOtp(sessionId, body.code);
  }

  @Post('sessions/:sessionId/account')
  createCheckoutAccount(
    @Param('sessionId') sessionId: string,
    @Headers('x-checkout-token') checkoutToken: string | undefined,
    @Body() body: CreateCheckoutAccountDto,
  ) {
    return this.identity.createAccount(sessionId, checkoutToken, body.password);
  }

  @Post('events')
  trackCheckoutEvent(@Body() body: CheckoutEventDto) {
    return this.identity.trackEvent(
      body.checkoutSessionId,
      body.name,
      body.metadata,
      body.deviceClass,
    );
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  listCustomerOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.checkoutService.listCustomerOrders(user.userId);
  }

  @Get('orders/:orderId')
  async getOrder(
    @Param('orderId') orderId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-checkout-session') checkoutSessionId: string | undefined,
    @Headers('x-checkout-token') checkoutToken: string | undefined,
  ) {
    const accountToken = authorization?.replace(/^Bearer\s+/i, '').trim();
    const userId = accountToken
      ? this.auth.verifyToken(accountToken).sub
      : undefined;
    return this.checkoutService.getCustomerOrder(orderId, {
      userId,
      checkoutSessionId,
      checkoutToken,
    });
  }

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

  /**
   * Live shipping estimate for a cart destination. Deliberately public —
   * checkout only requires sign-in at the final "Place order" step, and this
   * quote doesn't read the buyer's identity at all (cartId + country/currency
   * is all `quoteShipping` needs).
   */
  @Post(':cartId/shipping-quote')
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
  async checkout(
    @Param('cartId') cartId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-checkout-session') checkoutSessionId: string | undefined,
    @Headers('x-checkout-token') checkoutToken: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CheckoutDto,
  ) {
    let user: AuthenticatedUser | undefined;
    const accountToken = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (accountToken) {
      const payload = this.auth.verifyToken(accountToken);
      user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        sellerIds: payload.sellerIds ?? [],
      };
    }
    return this.checkoutService.processCheckout(
      cartId,
      user
        ? {
            buyerId: user.userId,
            email: user.email,
            ...(body.email ? { email: body.email } : {}),
            name: body.name,
            phone: body.phone,
          }
        : { name: body.name, email: body.email, phone: body.phone },
      body.shippingAddress,
      body.chargeCurrency,
      body.paymentProvider,
      { checkoutSessionId, checkoutToken, idempotencyKey },
    );
  }
}
