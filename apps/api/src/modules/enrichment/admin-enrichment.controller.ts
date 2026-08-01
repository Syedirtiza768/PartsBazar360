import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OpenRouterClient } from '../listing-pipeline/openrouter-client';
import { ENRICHMENT_VERSION, ENRICHMENT_PDP_PRIORITY } from './enrichment.service';
import {
  generateInfographicSpec,
  INFOGRAPHIC_VERSION,
} from './infographic-spec';

@Controller('admin/enrichment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminEnrichmentController {
  constructor(
    @InjectQueue('enrichment') private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /admin/enrichment/requeue-all
   *
   * Full re-enrichment via BullMQ (RealTrack + infographics).
   * Optionally filter by seller name.
   */
  @Post('requeue-all')
  async requeueAll(
    @Body()
    body: { sellerName?: string; batchSize?: number; dryRun?: boolean } = {},
  ) {
    const batchSize = Math.min(Math.max(body.batchSize ?? 500, 1), 5000);
    const dryRun = body.dryRun ?? false;
    const sellerName = body.sellerName?.trim();

    let scopedPartIds: Set<string> | null = null;
    if (sellerName) {
      const offers = await this.prisma.sellerOffer.findMany({
        where: {
          seller: { name: { contains: sellerName, mode: 'insensitive' } },
          status: 'ACTIVE',
        },
        select: { canonicalPartId: true },
        distinct: ['canonicalPartId'],
      });
      scopedPartIds = new Set(offers.map((o) => o.canonicalPartId));
      if (scopedPartIds.size === 0) {
        return { enqueued: 0, dryRun, sellerName, message: 'No parts found for seller' };
      }
    }

    let totalEnqueued = 0;
    let cursor: string | undefined;

    while (true) {
      const parts = await this.prisma.canonicalPart.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true },
      });

      if (!parts.length) break;
      cursor = parts[parts.length - 1].id;

      const filtered = scopedPartIds
        ? parts.filter((p) => scopedPartIds!.has(p.id))
        : parts;

      if (!filtered.length) continue;

      if (!dryRun) {
        const ids = filtered.map((p) => p.id);

        await this.prisma.canonicalPart.updateMany({
          where: { id: { in: ids } },
          data: {
            infographicSpec: null as any,
            infographicVersion: 0,
            infographicGeneratedAt: null,
            enrichmentStatus: 'QUEUED',
            enrichmentVersion: 0,
          },
        });

        for (const part of filtered) {
          await this.queue.add(
            'enrich-part',
            { partId: part.id, reason: 'admin_requeue' },
            {
              jobId: `enrich:${part.id}:v${ENRICHMENT_VERSION}`,
              priority: ENRICHMENT_PDP_PRIORITY,
              attempts: 2,
              backoff: { type: 'exponential', delay: 5_000 },
              removeOnComplete: 500,
              removeOnFail: 200,
            },
          );
        }
      }

      totalEnqueued += filtered.length;
    }

    return {
      enqueued: totalEnqueued,
      enrichmentVersion: ENRICHMENT_VERSION,
      infographicVersion: INFOGRAPHIC_VERSION,
      sellerName: sellerName || null,
      dryRun,
    };
  }

  /**
   * POST /admin/enrichment/generate-infographics
   *
   * Directly generates AI infographic SVG specs for parts — no RealTrack,
   * no price gate, no BullMQ queue. Runs inline and returns cost.
   *
   * Call repeatedly with increasing `offset` until `hasMore` is false.
   *
   * Body:
   *   sellerName (required) — e.g. "Superior Auto Parts"
   *   batchSize  (optional, default 20) — parts per call
   *   offset     (optional, default 0) — pagination cursor
   *   model      (optional) — override model, e.g. "xiaomi/mimo-v2.5-pro"
   *   dryRun     (optional, default false) — count without generating
   */
  @Post('generate-infographics')
  async generateInfographics(
    @Body()
    body: {
      sellerName: string;
      batchSize?: number;
      offset?: number;
      model?: string;
      dryRun?: boolean;
    },
  ) {
    const sellerName = body.sellerName?.trim();
    if (!sellerName) {
      return { error: 'sellerName is required' };
    }

    const batchSize = Math.min(Math.max(body.batchSize ?? 20, 1), 100);
    const offset = Math.max(body.offset ?? 0, 0);
    const dryRun = body.dryRun ?? false;
    const modelOverride = body.model?.trim() || undefined;

    // Find active part IDs for this seller that lack an infographic.
    const offers = await this.prisma.sellerOffer.findMany({
      where: {
        seller: { name: { contains: sellerName, mode: 'insensitive' } },
        status: 'ACTIVE',
      },
      select: { canonicalPartId: true },
      distinct: ['canonicalPartId'],
    });

    const allPartIds = [...new Set(offers.map((o) => o.canonicalPartId))];

    // Filter to parts missing infographicSpec.
    const partsNeeding = await this.prisma.canonicalPart.findMany({
      where: {
        id: { in: allPartIds },
        infographicSpec: { equals: null as any },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      skip: offset,
      take: batchSize,
    });

    const totalMissing = await this.prisma.canonicalPart.count({
      where: {
        id: { in: allPartIds },
        infographicSpec: { equals: null as any },
      },
    });

    if (dryRun) {
      return {
        totalForSeller: allPartIds.length,
        totalMissing,
        batchSize,
        offset,
        wouldProcess: partsNeeding.length,
        hasMore: offset + partsNeeding.length < totalMissing,
        model: modelOverride || 'xiaomi/mimo-v2.5-pro (default)',
        dryRun: true,
      };
    }

    // Build OpenRouter client.
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!apiKey) {
      return { error: 'OPENROUTER_API_KEY not set on server' };
    }
    const client = new OpenRouterClient(apiKey);

    // Optionally override the model env var for this request.
    const prevModel = process.env.INFOGRAPHIC_MODEL;
    if (modelOverride) {
      process.env.INFOGRAPHIC_MODEL = modelOverride;
    }

    const results: Array<{
      partId: string;
      ok: boolean;
      costUsd?: number;
      error?: string;
    }> = [];

    let totalCost = 0;

    for (const part of partsNeeding) {
      try {
        const full = await this.prisma.canonicalPart.findUnique({
          where: { id: part.id },
          select: {
            title: true,
            brand: true,
            category: true,
            partSource: true,
            qualityTier: true,
            manufacturerPartNumber: true,
            oeNumbers: true,
            material: true,
            position: true,
            itemSpecifics: true,
            weight: true,
          },
        });

        if (!full) {
          results.push({ partId: part.id, ok: false, error: 'not found' });
          continue;
        }

        const result = await generateInfographicSpec(client, {
          title: full.title,
          brand: full.brand,
          category: full.category,
          partSource: full.partSource,
          qualityTier: full.qualityTier,
          manufacturerPartNumber: full.manufacturerPartNumber,
          oeNumbers: full.oeNumbers,
          material: full.material,
          position: full.position,
          itemSpecifics: full.itemSpecifics,
          weightKg: full.weight,
        });

        if (result) {
          await this.prisma.canonicalPart.update({
            where: { id: part.id },
            data: {
              infographicSpec: result.spec as any,
              infographicVersion: INFOGRAPHIC_VERSION,
              infographicGeneratedAt: new Date(),
            },
          });
          totalCost += result.costUsd;
          results.push({ partId: part.id, ok: true, costUsd: result.costUsd });
        } else {
          results.push({ partId: part.id, ok: false, error: 'model returned unusable spec' });
        }
      } catch (err: any) {
        results.push({
          partId: part.id,
          ok: false,
          error: err?.message || String(err),
        });
      }
    }

    // Restore env.
    if (modelOverride) {
      if (prevModel !== undefined) {
        process.env.INFOGRAPHIC_MODEL = prevModel;
      } else {
        delete process.env.INFOGRAPHIC_MODEL;
      }
    }

    const nextOffset = offset + partsNeeding.length;

    return {
      processed: partsNeeding.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      costUsd: Math.round(totalCost * 10_000) / 10_000,
      nextOffset,
      totalMissing,
      hasMore: nextOffset < totalMissing,
      model: modelOverride || 'xiaomi/mimo-v2.5-pro (default)',
      dryRun: false,
      failures: results
        .filter((r) => !r.ok)
        .slice(0, 10)
        .map((r) => ({ partId: r.partId, error: r.error })),
    };
  }
}
