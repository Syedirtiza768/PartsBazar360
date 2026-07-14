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
        { id: '79f249a5-31e0-42a8-978c-a99b0665c61b', name: 'All About Mercedes', country: 'US' },
        { id: 'fa528c8a-f249-4816-94f6-f2ce8b932449', name: 'B.JLRWORLD', country: 'US' },
        { id: 'd16199c4-55b5-429e-ad27-892bed94e00d', name: 'BLACKLINEAUTOPARTS', country: 'US' },
        { id: '5fc75f19-31f3-44e4-b1ae-6545055f7945', name: 'K. Brit Auto Depot - UK', country: 'UK' },
        { id: '65aff8ec-21ee-460f-af17-20daa0b843c1', name: 'K. Euro Japan Auto Parts', country: 'US' },
        { id: 'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0', name: 'K. Salvage Auto Parts', country: 'US' },
        { id: 'cc658cc0-ab21-4519-9f06-4aea8ff6a809', name: 'K. Salvage Dismantlers - DE', country: 'DE' },
        { id: '7658e52e-4dd6-48a7-ad78-6933630bdac7', name: 'K. Southern Cross Auto Parts - AU', country: 'AU' },
        { id: 'cfcc4a9c-c41b-4166-ab41-989c00a6fad1', name: 'Primemotive', country: 'US' },
        { id: '8d7d8b23-d769-4ed5-91e2-e26d14a45215', name: 'VW & RR', country: 'US' },
        { id: '70ad5c44-6424-4998-815c-99adf28c2487', name: 'eBay store', country: 'US' },
      ]
    };
  }

  @Post('sync/realtrack/:storeId')
  async triggerRealTrackSync(@Param('storeId') storeId: string, @Body('page') page?: number) {
    this.logger.log(`Triggering manual sync for store: ${storeId}`);

    const job = await this.ingestionQueue.add('sync-store', {
      storeId,
      page: page || 1,
    });

    return {
      message: 'Sync job queued successfully',
      jobId: job.id,
      storeId,
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
