import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { SellerOnboardingService } from './onboarding.service';
import type { SellerProfileInput } from './onboarding.service';

@Controller('merchant/onboarding')
export class SellerOnboardingController {
  constructor(private readonly onboarding: SellerOnboardingService) {}

  @Get()
  get(@Query('sellerId') sellerId: string) {
    return this.onboarding.getSellerOnboarding(sellerId);
  }

  @Patch('profile')
  saveProfile(@Query('sellerId') sellerId: string, @Body() body: SellerProfileInput) {
    return this.onboarding.saveProfile(sellerId, body);
  }

  @Post('submit')
  submit(
    @Query('sellerId') sellerId: string,
    @Body() body: { acceptedByEmail: string; agreementVersion?: string },
  ) {
    return this.onboarding.submit(sellerId, body);
  }
}
