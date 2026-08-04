import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // POST /support/tickets � public (buyers submit tickets without auth)
  @Post('tickets')
  async createTicket(
    @Body()
    body: {
      orderId?: string;
      sellerOrderId?: string;
      canonicalPartId?: string;
      sellerOfferId?: string;
      customerName?: string;
      customerEmail: string;
      category: string;
      subject: string;
      message: string;
      shippingCountry?: string;
      estimatedWeightKg?: number;
      cartSummary?: string;
    },
  ) {
    return this.support.createTicket(body);
  }

  // GET /support/tickets � admin or support agent
  @Get('tickets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPPORT_AGENT')
  async listTickets(
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
    @Query('category') category?: string,
  ) {
    return this.support.listTickets({ status, orderId, category });
  }

  // GET /support/tickets/:id � admin or support agent
  @Get('tickets/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPPORT_AGENT')
  async getTicket(@Param('id') id: string) {
    return this.support.getTicket(id);
  }

  // PATCH /support/tickets/:id � admin or support agent
  @Patch('tickets/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPPORT_AGENT')
  async updateTicket(
    @Param('id') id: string,
    @Body()
    body: {
      status?: string;
      priority?: string;
      internalNotes?: string;
      assignedToUserId?: string | null;
      carrier?: string | null;
      quotedRate?: number | null;
      quotedCurrency?: string | null;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.support.updateTicket(id, body, user);
  }

  // POST /support/tickets/:id/reply � admin or support agent
  @Post('tickets/:id/reply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPPORT_AGENT')
  async replyToTicket(
    @Param('id') id: string,
    @Body() body: { message: string; replyBy?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.support.replyToTicket(id, body.message, body.replyBy, user);
  }
}
