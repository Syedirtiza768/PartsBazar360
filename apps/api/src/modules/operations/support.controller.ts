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

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // POST /support/tickets — public (buyers submit tickets without auth)
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

  // GET /support/tickets — admin only
  @Get('tickets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async listTickets(
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
    @Query('category') category?: string,
  ) {
    return this.support.listTickets({ status, orderId, category });
  }

  // PATCH /support/tickets/:id — admin only
  @Patch('tickets/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async updateTicket(
    @Param('id') id: string,
    @Body()
    body: { status?: string; priority?: string; internalNotes?: string },
  ) {
    return this.support.updateTicket(id, body);
  }

  // POST /support/tickets/:id/reply — admin only
  @Post('tickets/:id/reply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async replyToTicket(
    @Param('id') id: string,
    @Body() body: { message: string; replyBy?: string },
  ) {
    return this.support.replyToTicket(id, body.message, body.replyBy);
  }
}