import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

/**
 * Generic AuditEvent writer for domains outside catalog governance (which
 * already has its own CatalogAuditService). Kept separate rather than
 * renaming/reusing that one, to avoid touching working catalog-import code.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: {
    action: string;
    entityType: string;
    entityId: string;
    actorType?: string;
    actorId?: string;
    originalValue?: unknown;
    normalizedValue?: unknown;
    metadata?: unknown;
  }) {
    return this.prisma.auditEvent.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        actorType: input.actorType || 'ADMIN',
        actorId: input.actorId,
        originalValue:
          input.originalValue === undefined
            ? undefined
            : (input.originalValue as Prisma.InputJsonValue),
        normalizedValue:
          input.normalizedValue === undefined
            ? undefined
            : (input.normalizedValue as Prisma.InputJsonValue),
        metadata:
          input.metadata === undefined
            ? undefined
            : (input.metadata as Prisma.InputJsonValue),
      },
    });
  }
}
