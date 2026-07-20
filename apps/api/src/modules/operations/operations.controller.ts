import { Controller, Post, Param, Body, Logger, Get, Patch } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import {
  REALTRACK_MARKETPLACE_SELLERS,
  resolveRealTrackSyncTarget,
} from '../seed/marketplace-sellers.config';

@Controller('operations')
export class OperationsController {
  private readonly logger = new Logger(OperationsController.name);

  constructor(
    @InjectQueue('ingestion') private readonly ingestionQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

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
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.sellerUploadJob.count({ where: { status: { in: ['PROCESSING', 'NEEDS_REVIEW'] } } }),
      this.prisma.sellerOrder.count({ where: { status: { in: ['PROCESSING', 'READY_TO_SHIP'] } } }),
      this.prisma.order.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: { sellerOrders: { include: { seller: true, items: true } }, paymentIntent: true },
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
            items: { include: { sellerOffer: { include: { canonicalPart: true } } } },
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
    @Body() body: { status?: string; trackingNumber?: string; carrier?: string },
  ) {
    return this.prisma.sellerOrder.update({
      where: { id: sellerOrderId },
      data: {
        status: body.status || undefined,
        trackingNumber: body.trackingNumber || undefined,
        carrier: body.carrier || undefined,
      },
      include: {
        seller: true,
        parentOrder: true,
        items: { include: { sellerOffer: { include: { canonicalPart: true } } } },
      },
    });
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
  async triggerRealTrackSync(@Param('storeSlug') storeSlug: string, @Body('page') page?: number) {
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
  async triggerMarketplaceSync(@Param('marketplaceId') marketplaceId: string, @Body('page') page?: number) {
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
    this.logger.log('Triggering marketplace RealTrack sync (Salvage + Blackline only)');

    const job = await this.ingestionQueue.add('sync-marketplace-realtrack', {});

    return {
      message: 'Marketplace RealTrack sync queued for Salvage Auto Parts and Blackline Auto Parts only',
      jobId: job.id,
      stores: REALTRACK_MARKETPLACE_SELLERS.map((s) => ({ name: s.name, storeId: s.storeId })),
    };
  }
}
