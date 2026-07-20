import { Controller, Post, Param, Body, Logger, Get, Patch } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma.service';

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
      stores: [
        { slug: 'salvagea', id: '3b84b063-3811-481f-a61d-f7846a03558f', name: 'SalvageA', country: 'US' },
        { slug: 'blackline', id: 'd16199c4-55b5-429e-ad27-892bed94e00d', name: 'Blackline', country: 'US' },
      ]
    };
  }

  @Post('sync/realtrack/:storeSlug')
  async triggerRealTrackSync(@Param('storeSlug') storeSlug: string, @Body('page') page?: number) {
    this.logger.log(`Triggering manual sync for store: ${storeSlug}`);

    const job = await this.ingestionQueue.add('sync-store', {
      storeSlug,
      page: page || 1,
    });

    return {
      message: 'Sync job queued successfully',
      jobId: job.id,
      storeSlug,
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
    this.logger.log('Triggering full US marketplace sync for all stores');

    const job = await this.ingestionQueue.add('sync-all-us', {});

    return {
      message: 'Full US marketplace sync job queued successfully',
      jobId: job.id,
    };
  }
}
