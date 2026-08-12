import {
  BadRequestException,
  ConflictException,
  Controller,
  Post,
  Param,
  Body,
  Logger,
  Get,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  SellerOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EmailService } from '../email/email.service';
import { OrderStatusService } from '../order/order-status.service';
import { StripeService } from '../checkout/stripe.service';
import { TamaraService, type TamaraCurrency } from '../checkout/tamara.service';
import { AuditService } from '../audit/audit.service';
import {
  REALTRACK_MARKETPLACE_SELLERS,
  resolveRealTrackSyncTarget,
} from '../seed/marketplace-sellers.config';

class UpdateSellerOrderFulfillmentDto {
  @IsOptional()
  @IsEnum(SellerOrderStatus)
  status?: SellerOrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  carrier?: string;
}

@Controller('operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class OperationsController {
  private readonly logger = new Logger(OperationsController.name);
  private readonly redis: Redis;

  constructor(
    @InjectQueue('ingestion') private readonly ingestionQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly orderStatus: OrderStatusService,
    private readonly stripeService: StripeService,
    private readonly tamaraService: TamaraService,
    private readonly audit: AuditService,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: null,
    });
  }

  @Get('dashboard')
  @Roles('ADMIN', 'FULFILLMENT_OPERATOR', 'SUPPORT_AGENT')
  async getDashboard() {
    const [
      openTickets,
      uploadJobs,
      pendingSellerOrders,
      recentOrders,
      recentUploads,
      recentTickets,
    ] = await Promise.all([
      this.prisma.supportTicket.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      this.prisma.sellerUploadJob.count({
        where: { status: { in: ['PROCESSING', 'NEEDS_REVIEW'] } },
      }),
      this.prisma.sellerOrder.count({
        where: { status: 'PROCESSING' },
      }),
      this.prisma.order.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          sellerOrders: { include: { seller: true, items: true } },
          paymentIntent: true,
        },
      }),
      this.prisma.sellerUploadJob.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: { seller: true },
      }),
      this.prisma.supportTicket.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: { order: true, sellerOrder: { include: { seller: true } } },
      }),
    ]);

    return {
      metrics: {
        openTickets,
        uploadJobs,
        pendingSellerOrders,
        recentOrderCount: recentOrders.length,
      },
      recentOrders,
      recentUploads,
      recentTickets,
    };
  }

  @Get('orders')
  @Roles('ADMIN', 'FULFILLMENT_OPERATOR')
  async listMarketplaceOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: OrderStatus,
    @Query('buyerEmail') buyerEmail?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const pageNum = Math.max(1, page ? parseInt(page, 10) || 1 : 1);
    const take = Math.min(
      Math.max(1, limit ? parseInt(limit, 10) || 25 : 25),
      100,
    );
    const skip = (pageNum - 1) * take;

    const where: Prisma.OrderWhereInput = {};
    if (status) {
      if (!Object.values(OrderStatus).includes(status)) {
        throw new BadRequestException(`Unknown status: ${status}`);
      }
      where.status = status;
    }
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    if (buyerEmail) {
      const [buyers, customers] = await Promise.all([
        this.prisma.user.findMany({
          where: { email: { contains: buyerEmail, mode: 'insensitive' } },
          select: { id: true },
        }),
        this.prisma.customer.findMany({
          where: { email: { contains: buyerEmail, mode: 'insensitive' } },
          select: { id: true },
        }),
      ]);
      where.OR = [
        { buyerId: { in: buyers.map((b) => b.id) } },
        { customerId: { in: customers.map((c) => c.id) } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          sellerOrders: {
            include: {
              seller: true,
              items: {
                include: { sellerOffer: { include: { canonicalPart: true } } },
              },
              supportTickets: true,
            },
          },
          paymentIntent: true,
          supportTickets: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page: pageNum, limit: take };
  }

  @Get('orders/:orderId')
  @Roles('ADMIN', 'FULFILLMENT_OPERATOR')
  async getOrderDetail(@Param('orderId') orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        sellerOrders: {
          include: {
            seller: true,
            items: {
              include: { sellerOffer: { include: { canonicalPart: true } } },
            },
            supportTickets: true,
          },
        },
        paymentIntent: true,
        supportTickets: true,
        customer: {
          select: { id: true, name: true, email: true, phoneNormalized: true },
        },
      },
    });

    const accountBuyer = order.buyerId
      ? await this.prisma.user.findUnique({
          where: { id: order.buyerId },
          select: { id: true, name: true, email: true, phone: true },
        })
      : null;

    const buyer = accountBuyer ||
      (order.customer
        ? {
            id: order.customer.id,
            name: order.customer.name,
            email: order.customer.email,
            phone: order.customer.phoneNormalized,
          }
        : order.verifiedPhone
          ? {
              id: `guest:${order.id}`,
              name: null,
              email: null,
              phone: order.verifiedPhone,
            }
          : null);

    return { ...order, buyer };
  }

  @Post('orders/:orderId/cancel')
  async cancelOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { sellerOrders: true, paymentIntent: true },
    });

    if (order.status === OrderStatus.CANCELLED) return order;
    if (order.status === OrderStatus.REFUNDED) {
      throw new BadRequestException('This order has already been refunded');
    }

    const shippedStatuses: SellerOrderStatus[] = [
      SellerOrderStatus.SHIPPED,
      SellerOrderStatus.DELIVERED,
    ];
    const alreadyShipped = order.sellerOrders.some((so) =>
      shippedStatuses.includes(so.status),
    );
    if (alreadyShipped) {
      throw new BadRequestException(
        'Cannot cancel an order once any seller has shipped — use refund instead',
      );
    }

    let refunded = false;
    if (order.paymentIntent?.status === PaymentStatus.SUCCEEDED) {
      await this.refundPayment(
        order.paymentIntent,
        `Order ${orderId} cancelled by admin`,
      );
      refunded = true;
    }

    const [updatedOrder] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      }),
      this.prisma.sellerOrder.updateMany({
        where: {
          parentOrderId: orderId,
          status: {
            in: [
              SellerOrderStatus.AWAITING_PAYMENT,
              SellerOrderStatus.PROCESSING,
            ],
          },
        },
        data: { status: SellerOrderStatus.CANCELLED },
      }),
    ]);

    await this.audit.record({
      action: 'ORDER_CANCELLED',
      entityType: 'Order',
      entityId: orderId,
      actorType: user.role,
      actorId: user.userId,
      originalValue: { status: order.status },
      normalizedValue: { status: OrderStatus.CANCELLED },
      metadata: { refunded },
    });

    return { ...updatedOrder, refunded };
  }

  @Post('orders/:orderId/refund')
  async refundOrder(
    @Param('orderId') orderId: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { paymentIntent: true },
    });

    if (!order.paymentIntent) {
      throw new BadRequestException('This order has no payment to refund');
    }
    if (order.paymentIntent.status !== PaymentStatus.SUCCEEDED) {
      throw new BadRequestException(
        `Only a succeeded payment can be refunded (current: ${order.paymentIntent.status})`,
      );
    }

    await this.refundPayment(
      order.paymentIntent,
      body.reason || `Order ${orderId} refunded by admin`,
    );

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.REFUNDED },
      include: { paymentIntent: true },
    });

    await this.audit.record({
      action: 'ORDER_REFUNDED',
      entityType: 'Order',
      entityId: orderId,
      actorType: user.role,
      actorId: user.userId,
      originalValue: { status: order.status },
      normalizedValue: { status: OrderStatus.REFUNDED },
      metadata: { reason: body.reason },
    });

    return updated;
  }

  /** Routes a refund to the right payment provider and marks the PaymentIntent REFUNDED once it succeeds. */
  private async refundPayment(
    payment: {
      id: string;
      provider: string;
      externalId: string | null;
      amount: number;
      currency: string;
    },
    reasonNote: string,
  ): Promise<void> {
    if (!payment.externalId) {
      throw new BadRequestException(
        'Payment has no provider reference to refund',
      );
    }
    if (payment.provider === 'stripe') {
      await this.stripeService.refundPayment(payment.externalId, reasonNote);
    } else if (payment.provider === 'tamara') {
      await this.tamaraService.refundOrder({
        orderId: payment.externalId,
        amount: payment.amount,
        currency: payment.currency as TamaraCurrency,
        comment: reasonNote,
      });
    } else {
      throw new BadRequestException(
        `Unsupported payment provider for refund: ${payment.provider}`,
      );
    }
    await this.prisma.paymentIntent.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.REFUNDED },
    });
  }

  @Patch('seller-orders/:sellerOrderId/fulfillment')
  @Roles('ADMIN', 'FULFILLMENT_OPERATOR')
  async updateSellerOrderFulfillment(
    @Param('sellerOrderId') sellerOrderId: string,
    @Body() body: UpdateSellerOrderFulfillmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (
      body.status === undefined &&
      body.trackingNumber === undefined &&
      body.carrier === undefined
    ) {
      throw new BadRequestException('Provide a delivery status or shipment details');
    }

    const current = await this.prisma.sellerOrder.findUniqueOrThrow({
      where: { id: sellerOrderId },
      select: { status: true },
    });

    if (body.status) {
      this.orderStatus.assertSellerOrderTransition(current.status, body.status);
    }

    const trackingNumber =
      body.trackingNumber === undefined
        ? undefined
        : body.trackingNumber.trim() || null;
    const carrier =
      body.carrier === undefined ? undefined : body.carrier.trim() || null;
    const updated = await this.prisma.sellerOrder.updateMany({
      where: {
        id: sellerOrderId,
        ...(body.status ? { status: current.status } : {}),
      },
      data: {
        status: body.status,
        trackingNumber,
        carrier,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        'This seller order changed while you were editing it. Refresh and try again.',
      );
    }

    const sellerOrder = await this.prisma.sellerOrder.findUniqueOrThrow({
      where: { id: sellerOrderId },
      include: {
        seller: true,
        parentOrder: {
          include: { customer: { select: { email: true } } },
        },
        items: {
          include: { sellerOffer: { include: { canonicalPart: true } } },
        },
      },
    });

    if (body.status && current.status !== body.status) {
      await this.audit.record({
        action: 'SELLER_ORDER_STATUS_CHANGED',
        entityType: 'SellerOrder',
        entityId: sellerOrderId,
        actorType: user.role,
        actorId: user.userId,
        originalValue: { status: current.status },
        normalizedValue: { status: body.status },
        metadata: {
          trackingNumber: body.trackingNumber,
          carrier: body.carrier,
        },
      });
    }

    // Send shipment notification to buyer when tracking number is provided
    if (
      body.status === SellerOrderStatus.SHIPPED &&
      current.status !== SellerOrderStatus.SHIPPED &&
      sellerOrder.parentOrder
    ) {
      const buyer = sellerOrder.parentOrder.buyerId
        ? await this.prisma.user.findUnique({
            where: { id: sellerOrder.parentOrder.buyerId },
            select: { email: true },
          })
        : null;
      const shippingAddress = sellerOrder.parentOrder.shippingAddress as Record<
        string,
        string
      > | null;
      const buyerEmail =
        buyer?.email ||
        sellerOrder.parentOrder.customer?.email ||
        shippingAddress?.email;
      if (body.trackingNumber && buyerEmail) {
        void this.emailService
          .sendShipmentNotification(buyerEmail, {
            orderId: sellerOrder.parentOrderId,
            sellerName: sellerOrder.seller?.name || 'Marketplace seller',
            trackingNumber: body.trackingNumber,
            carrier: body.carrier,
            items: sellerOrder.items.map((item) => ({
              name:
                item.sellerOffer.canonicalPart?.title ||
                item.sellerOffer.sellerTitle ||
                'Auto part',
              quantity: item.quantity,
            })),
          })
          .catch((err) =>
            this.logger.error(`Shipment notification failed: ${err}`),
          );
      }
    }

    return sellerOrder;
  }

  @Get('stores')
  async getStores() {
    return {
      stores: REALTRACK_MARKETPLACE_SELLERS.map((s) => ({
        slug: s.key,
        id: s.storeId,
        name: s.name,
        storeSlug: s.storeSlug,
      })),
    };
  }

  @Post('sync/realtrack/:storeSlug')
  async triggerRealTrackSync(
    @Param('storeSlug') storeSlug: string,
    @Body('page') page?: number,
  ) {
    this.logger.log(`Triggering manual sync for store: ${storeSlug}`);
    const target = resolveRealTrackSyncTarget({ storeSlug });

    const job = await this.ingestionQueue.add('sync-store', {
      storeId: target.storeId,
      storeSlug: target.storeSlug || target.key,
      page: page || 1,
    });

    return {
      message: `Sync job queued for ${target.name} only`,
      jobId: job.id,
      storeSlug: target.key,
      storeId: target.storeId,
      seller: target.name,
    };
  }

  @Post('sync/marketplace/:marketplaceId')
  async triggerMarketplaceSync(
    @Param('marketplaceId') marketplaceId: string,
    @Body('page') page?: number,
  ) {
    this.logger.log(`Triggering marketplace sync for: ${marketplaceId}`);

    const job = await this.ingestionQueue.add('sync-marketplace', {
      marketplaceId,
      page: page || 1,
    });

    return {
      message: 'Marketplace sync job queued successfully',
      jobId: job.id,
      marketplaceId,
    };
  }

  @Post('sync/all-us')
  async triggerAllUSSync() {
    this.logger.log(
      'Triggering marketplace RealTrack sync (Salvage + Blackline only)',
    );

    // Check if a sync is already running
    const activeRunId = await this.redis.get('sync:activeRunId');
    if (activeRunId) {
      return {
        message: 'Sync already in progress',
        syncRunId: activeRunId,
        monitorUrl: `/operations/sync/progress/${activeRunId}`,
      };
    }

    const job = await this.ingestionQueue.add('sync-marketplace-realtrack', {});

    return {
      message:
        'Marketplace RealTrack sync queued for Salvage Auto Parts and Blackline Auto Parts only',
      jobId: job.id,
      stores: REALTRACK_MARKETPLACE_SELLERS.map((s) => ({
        name: s.name,
        storeId: s.storeId,
      })),
      monitor: 'GET /operations/sync/progress/:syncRunId (runId appears in worker logs)',
    };
  }

  @Get('sync/progress/:syncRunId')
  async getSyncProgress(@Param('syncRunId') syncRunId: string) {
    const stores = REALTRACK_MARKETPLACE_SELLERS;
    const progress: Record<string, any> = {};

    for (const store of stores) {
      const key = `sync:progress:${syncRunId}:${store.storeId}`;
      const data = await this.redis.hgetall(key);
      const lastPage = await this.redis.get(`${key}:lastPage`);
      progress[store.name] = {
        ...data,
        lastCompletedPage: lastPage ? Number(lastPage) : null,
      };
    }

    const activeRunId = await this.redis.get('sync:activeRunId');
    return {
      syncRunId,
      isActive: activeRunId === syncRunId,
      stores: progress,
    };
  }

  @Get('sync/active')
  async getActiveSync() {
    const activeRunId = await this.redis.get('sync:activeRunId');
    if (!activeRunId) {
      return { active: false, message: 'No sync running' };
    }
    // Return progress for active run
    return this.getSyncProgress(activeRunId);
  }
}
