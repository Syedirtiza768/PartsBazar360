import {
  Controller,
  Post,
  Param,
  Body,
  Logger,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EmailService } from '../email/email.service';
import {
  REALTRACK_MARKETPLACE_SELLERS,
  resolveRealTrackSyncTarget,
} from '../seed/marketplace-sellers.config';

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
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: null,
    });
  }

  @Get('dashboard')
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
        where: { status: { in: ['PROCESSING', 'READY_TO_SHIP'] } },
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
  async listMarketplaceOrders() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
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
    });
  }

  @Patch('seller-orders/:sellerOrderId/fulfillment')
  async updateSellerOrderFulfillment(
    @Param('sellerOrderId') sellerOrderId: string,
    @Body()
    body: { status?: string; trackingNumber?: string; carrier?: string },
  ) {
    const sellerOrder = await this.prisma.sellerOrder.update({
      where: { id: sellerOrderId },
      data: {
        status: body.status || undefined,
        trackingNumber: body.trackingNumber || undefined,
        carrier: body.carrier || undefined,
      },
      include: {
        seller: true,
        parentOrder: true,
        items: {
          include: { sellerOffer: { include: { canonicalPart: true } } },
        },
      },
    });

    // Send shipment notification to buyer when tracking number is provided
    if (body.trackingNumber && sellerOrder.parentOrder?.buyerId) {
      const buyer = await this.prisma.user.findUnique({
        where: { id: sellerOrder.parentOrder.buyerId },
      });
      if (buyer?.email) {
        void this.emailService
          .sendShipmentNotification(buyer.email, {
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