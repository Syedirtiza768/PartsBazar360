import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PricingService } from '../pricing/pricing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SellerId } from '../auth/seller-id.decorator';

@Controller('merchant/pricing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class MerchantPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  getPricing(@SellerId() sellerId: string) {
    return this.pricing.getSellerPricing(sellerId);
  }

  @Post('quote')
  quote(
    @SellerId() sellerId: string,
    @Body() body: { category?: string; sellerBasePrice: number },
  ) {
    return this.pricing.quote(
      sellerId,
      body.category,
      Number(body.sellerBasePrice),
    );
  }
}
