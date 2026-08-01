import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

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
    shippingCountry?: string;
    estimatedWeightKg?: number;
    cartSummary?: string;
  }) {
    if (!body.customerEmail?.trim())
      throw new BadRequestException('customerEmail is required');
    if (!body.subject?.trim())
      throw new BadRequestException('subject is required');
    if (!body.message?.trim())
      throw new BadRequestException('message is required');

    const priority =
      body.category === 'FITMENT' ||
      body.category === 'ORDER_ISSUE' ||
      body.category === 'FREIGHT_QUOTE'
        ? 'HIGH'
        : 'NORMAL';

    // Build structured message for freight quotes
    let message = body.message;
    if (body.category === 'FREIGHT_QUOTE') {
      const parts = [body.message];
      if (body.shippingCountry)
        parts.push(`\nShipping to: ${body.shippingCountry}`);
      if (body.estimatedWeightKg)
        parts.push(`Estimated weight: ${body.estimatedWeightKg}kg`);
      if (body.cartSummary) parts.push(`Cart: ${body.cartSummary}`);
      message = parts.join('\n');
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        orderId: body.orderId || null,
        sellerOrderId: body.sellerOrderId || null,
        canonicalPartId: body.canonicalPartId || null,
        sellerOfferId: body.sellerOfferId || null,
        customerName: body.customerName || null,
        customerEmail: body.customerEmail,
        category: body.category || 'GENERAL',
        subject: body.subject,
        message,
        priority,
      },
      include: {
        order: true,
        sellerOrder: true,
        canonicalPart: true,
        sellerOffer: true,
      },
    });

    // Notify admin of new ticket
    this.emailService.sendNewTicketAdminNotification({
      id: ticket.id,
      category: ticket.category,
      subject: ticket.subject,
      customerEmail: ticket.customerEmail,
      customerName: ticket.customerName ?? undefined,
      message: ticket.message,
      priority: ticket.priority,
    });

    return ticket;
  }

  async listTickets(query: {
    status?: string;
    orderId?: string;
    category?: string;
  }) {
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

  async updateTicket(
    id: string,
    body: { status?: string; priority?: string; internalNotes?: string },
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
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

  async replyToTicket(id: string, message: string, replyBy?: string) {
    if (!message?.trim()) {
      throw new BadRequestException('Reply message is required');
    }

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');

    // Append reply to internal notes (structured as a thread)
    const timestamp = new Date().toISOString();
    const replyBlock = `\n---\n[${timestamp}] Reply by ${replyBy || 'Operations'}:\n${message}`;
    const existingNotes = ticket.internalNotes || '';

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        internalNotes: `${existingNotes}${replyBlock}`,
        status: 'IN_PROGRESS',
      },
      include: {
        order: true,
        sellerOrder: { include: { seller: true } },
        canonicalPart: true,
        sellerOffer: { include: { seller: true } },
      },
    });

    // Send the reply to the customer by email
    void this.emailService
      .sendTicketReply(ticket.customerEmail, {
        ticketId: ticket.id,
        subject: ticket.subject,
        customerName: ticket.customerName ?? undefined,
        replyMessage: message,
      })
      .catch((err) =>
        this.logger.error(`Ticket reply email failed for ${ticket.id}: ${err}`),
      );

    return updated;
  }
}