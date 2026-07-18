import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import type { AuditAction } from '@repo/catalog-contracts';

@Injectable()
export class CatalogAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    action: AuditAction | string;
    entityType: string;
    entityId: string;
    actorType?: string;
    actorId?: string;
    source?: string;
    reason?: string;
    confidence?: number;
    originalValue?: unknown;
    normalizedValue?: unknown;
    metadata?: unknown;
    canonicalPartId?: string;
  }) {
    return this.prisma.auditEvent.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        actorType: input.actorType || 'SYSTEM',
        actorId: input.actorId,
        source: input.source,
        reason: input.reason,
        confidence: input.confidence,
        originalValue: input.originalValue === undefined ? undefined : (input.originalValue as Prisma.InputJsonValue),
        normalizedValue: input.normalizedValue === undefined ? undefined : (input.normalizedValue as Prisma.InputJsonValue),
        metadata: input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
        canonicalPartId: input.canonicalPartId,
      },
    });
  }
}
