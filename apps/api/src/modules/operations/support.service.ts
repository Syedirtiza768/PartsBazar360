import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(body: {
    orderId?: string;
    sellerOrderId?: string;
    canonicalPartId?: string;
    sellerOfferId?: string;
    customerName?: string;
    customerEmail: string;
    category: string;
    subject: string;
    message: string;
  }) {
    if (!body.customerEmail?.trim()) throw new BadRequestException('customerEmail is required');
    if (!body.subject?.trim()) throw new BadRequestException('subject is required');
    if (!body.message?.trim()) throw new BadRequestException('message is required');

    const priority = body.category === 'FITMENT' || body.category === 'ORDER_ISSUE' ? 'HIGH' : 'NORMAL';
    return this.prisma.supportTicket.create({
      data: {
        orderId: body.orderId || null,
        sellerOrderId: body.sellerOrderId || null,
        canonicalPartId: body.canonicalPartId || null,
        sellerOfferId: body.sellerOfferId || null,
        customerName: body.customerName || null,
        customerEmail: body.customerEmail,
        category: body.category || 'GENERAL',
        subject: body.subject,
        message: body.message,
        priority,
      },
      include: { order: true, sellerOrder: true, canonicalPart: true, sellerOffer: true },
    });
  }

  async listTickets(query: { status?: string; orderId?: string; category?: string }) {
    return this.prisma.supportTicket.findMany({
      where: {
        status: query.status || undefined,
        orderId: query.orderId || undefined,
        category: query.category || undefined,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        order: true,
        sellerOrder: { include: { seller: true } },
        canonicalPart: true,
        sellerOffer: { include: { seller: true } },
      },
    });
  }

  async updateTicket(id: string, body: { status?: string; priority?: string; internalNotes?: string }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: body.status ?? ticket.status,
        priority: body.priority ?? ticket.priority,
        internalNotes: body.internalNotes ?? ticket.internalNotes,
      },
    });
  }
}
