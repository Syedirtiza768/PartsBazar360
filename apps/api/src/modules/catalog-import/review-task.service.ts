import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import type { ReviewQueueType } from '@repo/catalog-contracts';

@Injectable()
export class ReviewTaskService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: {
    queueType: ReviewQueueType | string;
    title: string;
    description?: string;
    severity?: string;
    entityType?: string;
    entityId?: string;
    sellerId?: string;
    uploadJobId?: string;
    canonicalPartId?: string;
    payload?: unknown;
    confidence?: number;
  }) {
    return this.prisma.reviewTask.create({
      data: {
        queueType: input.queueType,
        title: input.title,
        description: input.description,
        severity: input.severity || 'MEDIUM',
        entityType: input.entityType,
        entityId: input.entityId,
        sellerId: input.sellerId,
        uploadJobId: input.uploadJobId,
        canonicalPartId: input.canonicalPartId,
        payload: input.payload === undefined ? undefined : (input.payload as Prisma.InputJsonValue),
        confidence: input.confidence,
      },
    });
  }

  async list(filters: { queueType?: string; status?: string; sellerId?: string; limit?: number } = {}) {
    return this.prisma.reviewTask.findMany({
      where: {
        queueType: filters.queueType || undefined,
        status: filters.status || 'OPEN',
        sellerId: filters.sellerId || undefined,
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: filters.limit ?? 100,
      include: {
        seller: true,
        uploadJob: true,
        canonicalPart: { select: { id: true, title: true, partType: true, brand: true, manufacturerPartNumber: true } },
      },
    });
  }

  async resolve(taskId: string, body: { status: string; resolution?: string; resolvedBy?: string }) {
    return this.prisma.reviewTask.update({
      where: { id: taskId },
      data: {
        status: body.status,
        resolution: body.resolution,
        resolvedBy: body.resolvedBy || 'admin',
        resolvedAt: new Date(),
      },
    });
  }

  async queueCounts() {
    const rows = await this.prisma.reviewTask.groupBy({
      by: ['queueType'],
      where: { status: 'OPEN' },
      _count: { _all: true },
    });
    return rows.map((row) => ({ queueType: row.queueType, count: row._count._all }));
  }
}
