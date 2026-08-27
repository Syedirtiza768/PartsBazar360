import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateDiscountCouponDto,
  UpdateDiscountCouponDto,
} from './discount-coupon.dto';
import { DiscountCouponService } from './discount-coupon.service';

@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class DiscountCouponController {
  constructor(private readonly coupons: DiscountCouponService) {}

  @Get()
  list() {
    return this.coupons.list();
  }

  @Post()
  create(
    @Body() body: CreateDiscountCouponDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.coupons.create(body, user.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateDiscountCouponDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.coupons.update(id, body, user.userId);
  }
}
