import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreatePaymentLinkDto } from './payment-link.dto';
import { PaymentLinkService } from './payment-link.service';

@Controller('admin/payment-links')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class PaymentLinkController {
  constructor(private readonly paymentLinks: PaymentLinkService) {}

  @Post()
  create(
    @Body() body: CreatePaymentLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentLinks.create(body, user.userId);
  }
}
