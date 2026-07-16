import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PricingService } from '../pricing/pricing.service';

@Controller('merchant/pricing')
export class MerchantPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  getPricing(@Query('sellerId') sellerId: string) {
    if (!sellerId) throw new BadRequestException('sellerId is required');
    return this.pricing.getSellerPricing(sellerId);
  }

  @Post('quote')
  quote(
    @Query('sellerId') sellerId: string,
    @Body() body: { category?: string; sellerBasePrice: number },
  ) {
    if (!sellerId) throw new BadRequestException('sellerId is required');
    return this.pricing.quote(sellerId, body.category, Number(body.sellerBasePrice));
  }
}
