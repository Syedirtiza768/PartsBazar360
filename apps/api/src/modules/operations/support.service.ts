import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * The public ticket form posts raw input values, so a blank weight field
 * arrives as "" and a filled one as "12.5". Prisma wants Float | null.
 */
export function parseOptionalWeightKg(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(
      'estimatedWeightKg must be a positive number',
    );
  }
  return n;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly audit: AuditService,
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
    estimatedWeightKg?: number | string | null;
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

    const isFreightQuote = body.category === 'FREIGHT_QUOTE';
    const estimatedWeightKg = isFreightQuote
      ? parseOptionalWeightKg(body.estimatedWeightKg)
      : null;

    const submittedOrderId = body.orderId?.trim();
    let orderId: string | null = null;
    if (submittedOrderId) {
      const order = await this.prisma.order.findFirst({
        where: {
          OR: [
            { id: submittedOrderId },
            { orderNumber: submittedOrderId.toUpperCase() },
          ],
        },
        select: { id: true },
      });
      if (!order) throw new BadRequestException('Order not found');
      orderId = order.id;
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        orderId,
        sellerOrderId: body.sellerOrderId || null,
        canonicalPartId: body.canonicalPartId || null,
        sellerOfferId: body.sellerOfferId || null,
        customerName: body.customerName || null,
        customerEmail: body.customerEmail,
        category: body.category || 'GENERAL',
        subject: body.subject,
        message: body.message,
        priority,
        shippingCountry: isFreightQuote ? body.shippingCountry || null : null,
        estimatedWeightKg,
        cartSummary: isFreightQuote ? body.cartSummary || null : null,
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
      shippingCountry: ticket.shippingCountry ?? undefined,
      estimatedWeightKg: ticket.estimatedWeightKg ?? undefined,
    });

    // Public ticket creation returns a receipt only. The related order, seller
    // order, offer, and catalog entities are available to staff through the
    // authenticated support endpoints, never to the guest submission caller.
    return {
      id: ticket.id,
      category: ticket.category,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      createdAt: ticket.createdAt,
    };
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

  async getTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        order: true,
        sellerOrder: { include: { seller: true } },
        canonicalPart: true,
        sellerOffer: { include: { seller: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');

    const assignedTo = ticket.assignedToUserId
      ? await this.prisma.user.findUnique({
          where: { id: ticket.assignedToUserId },
          select: { id: true, name: true, email: true },
        })
      : null;

    return { ...ticket, assignedTo };
  }

  async updateTicket(
    id: string,
    body: {
      status?: string;
      priority?: string;
      internalNotes?: string;
      assignedToUserId?: string | null;
      carrier?: string | null;
      quotedRate?: number | null;
      quotedCurrency?: string | null;
    },
    actor: AuthenticatedUser,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: body.status ?? ticket.status,
        priority: body.priority ?? ticket.priority,
        internalNotes: body.internalNotes ?? ticket.internalNotes,
        assignedToUserId:
          body.assignedToUserId !== undefined
            ? body.assignedToUserId
            : ticket.assignedToUserId,
        carrier: body.carrier !== undefined ? body.carrier : ticket.carrier,
        quotedRate:
          body.quotedRate !== undefined ? body.quotedRate : ticket.quotedRate,
        quotedCurrency:
          body.quotedCurrency !== undefined
            ? body.quotedCurrency
            : ticket.quotedCurrency,
      },
    });

    await this.audit.record({
      action: 'TICKET_UPDATED',
      entityType: 'SupportTicket',
      entityId: id,
      actorType: actor.role,
      actorId: actor.userId,
      originalValue: {
        status: ticket.status,
        priority: ticket.priority,
        assignedToUserId: ticket.assignedToUserId,
      },
      normalizedValue: {
        status: updated.status,
        priority: updated.priority,
        assignedToUserId: updated.assignedToUserId,
      },
    });

    return updated;
  }

  async replyToTicket(
    id: string,
    message: string,
    replyBy: string | undefined,
    actor: AuthenticatedUser,
  ) {
    if (!message?.trim()) {
      throw new BadRequestException('Reply message is required');
    }

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');

    const [, updated] = await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: {
          ticketId: id,
          authorType: 'ADMIN',
          authorName: replyBy || 'Operations',
          message,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id },
        data: { status: 'IN_PROGRESS' },
        include: {
          order: true,
          sellerOrder: { include: { seller: true } },
          canonicalPart: true,
          sellerOffer: { include: { seller: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      }),
    ]);

    await this.audit.record({
      action: 'TICKET_REPLIED',
      entityType: 'SupportTicket',
      entityId: id,
      actorType: actor.role,
      actorId: actor.userId,
      metadata: { messageLength: message.length },
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
