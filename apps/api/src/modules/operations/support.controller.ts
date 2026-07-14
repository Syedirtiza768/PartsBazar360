import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

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
    },
  ) {
    return this.support.createTicket(body);
  }

  @Get('tickets')
  async listTickets(
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
    @Query('category') category?: string,
  ) {
    return this.support.listTickets({ status, orderId, category });
  }

  @Patch('tickets/:id')
  async updateTicket(
    @Param('id') id: string,
    @Body() body: { status?: string; priority?: string; internalNotes?: string },
  ) {
    return this.support.updateTicket(id, body);
  }
}
