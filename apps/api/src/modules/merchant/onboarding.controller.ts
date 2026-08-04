import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { SellerOnboardingService } from './onboarding.service';
import type { SellerProfileInput } from './onboarding.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SellerId } from '../auth/seller-id.decorator';

@Controller('merchant/onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class SellerOnboardingController {
  constructor(private readonly onboarding: SellerOnboardingService) {}

  @Get()
  get(@SellerId() sellerId: string) {
    return this.onboarding.getSellerOnboarding(sellerId);
  }

  @Patch('profile')
  saveProfile(@SellerId() sellerId: string, @Body() body: SellerProfileInput) {
    return this.onboarding.saveProfile(sellerId, body);
  }

  @Post('submit')
  submit(
    @SellerId() sellerId: string,
    @Body() body: { acceptedByEmail: string; agreementVersion?: string },
  ) {
    return this.onboarding.submit(sellerId, body);
  }
}
