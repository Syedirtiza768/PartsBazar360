import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { REVIEW_QUEUE_TYPES } from '@repo/catalog-contracts';
import { ReviewTaskService } from './review-task.service';
import { CatalogAuditService } from './catalog-audit.service';
import { WeightRectifierService } from './weight-rectifier.service';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('admin/catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminCatalogController {
  constructor(
    private readonly reviews: ReviewTaskService,
    private readonly audit: CatalogAuditService,
    private readonly prisma: PrismaService,
    private readonly weightRectifier: WeightRectifierService,
  ) {}

  @Get('queues')
  async queues() {
    const counts = await this.reviews.queueCounts();
    return {
      queues: REVIEW_QUEUE_TYPES.map((queueType) => ({
        queueType,
        count: counts.find((row) => row.queueType === queueType)?.count || 0,
      })),
      openTotal: counts.reduce((sum, row) => sum + row.count, 0),
    };
  }

  @Get('reviews')
  async listReviews(
    @Query('queueType') queueType?: string,
    @Query('status') status?: string,
    @Query('sellerId') sellerId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviews.list({
      queueType,
      status,
      sellerId,
      limit: limit ? Number(limit) : 100,
    });
  }

  @Patch('reviews/:id')
  async resolveReview(
    @Param('id') id: string,
    @Body() body: { status: string; resolution?: string; resolvedBy?: string },
  ) {
    const task = await this.reviews.resolve(id, body);
    await this.audit.record({
      action: 'REVIEW_RESOLVE',
      entityType: 'ReviewTask',
      entityId: id,
      actorType: 'ADMIN',
      actorId: body.resolvedBy || 'admin',
      reason: body.resolution,
      metadata: { status: body.status, queueType: task.queueType },
      canonicalPartId: task.canonicalPartId || undefined,
    });
    return task;
  }

  @Get('audit')
  async listAudit(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('canonicalPartId') canonicalPartId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.prisma.auditEvent.findMany({
      where: {
        entityType: entityType || undefined,
        entityId: entityId || undefined,
        canonicalPartId: canonicalPartId || undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: limit ? Number(limit) : 100,
    });
  }

  @Get('brands')
  async listBrands(@Query('q') q?: string) {
    return this.prisma.brandMaster.findMany({
      where: q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { canonicalName: { contains: q.toUpperCase() } },
            ],
          }
        : undefined,
      include: { aliases: true },
      orderBy: { displayName: 'asc' },
      take: 100,
    });
  }

  @Get('makes')
  async listMakes(@Query('q') q?: string) {
    return this.prisma.vehicleMake.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: { aliases: true },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  @Get('weights/audit')
  async weightAudit() {
    return this.weightRectifier.audit();
  }

  @Post('weights/rectify')
  async rectifyWeights() {
    return this.weightRectifier.rectifyAll();
  }
}