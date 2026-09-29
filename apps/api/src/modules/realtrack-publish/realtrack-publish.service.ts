import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { partUrl } from '@repo/catalog-contracts';
import { PrismaService } from '../../prisma.service';
import { SearchOutboxService } from '../search/index/search-outbox.service';
import {
  PUSH_JOB_NAME,
  PUSH_STATUS_TTL_SECONDS,
  pushListingId,
  pushStatusKey,
  type PushListingJobData,
  type PushListingStatusRecord,
} from '../ingestion/realtrack-push.contract';
import type { EndListingsDto, PushListingsDto } from './realtrack-publish.dto';
import { validatePushedListing } from './realtrack-publish.validation';

export interface PushItemResult {
  sourceListingId: string;
  status: 'queued' | 'rejected';
  reason?: string;
}

@Injectable()
export class RealtrackPublishService {
  private readonly logger = new Logger(RealtrackPublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly searchOutbox: SearchOutboxService,
    @InjectQueue('ingestion') private readonly ingestionQueue: Queue,
  ) {}

  /** Resolve the seller a RealTrack store id maps to; throws when unmapped. */
  private async sellerForStore(storeId: string) {
    const seller = await this.prisma.seller.findFirst({
      where: { storeId },
      select: { id: true, name: true },
    });
    if (!seller) {
      throw new NotFoundException(
        `No PartsBazar360 seller is mapped to store ${storeId}`,
      );
    }
    return seller;
  }

  async health(storeId?: string) {
    const seller = storeId ? await this.sellerForStore(storeId) : null;
    return {
      ok: true,
      seller: seller ? { id: seller.id, name: seller.name } : null,
    };
  }

  async publish(dto: PushListingsDto) {
    const seller = await this.sellerForStore(dto.storeId);
    const client = await this.ingestionQueue.client;
    const results: PushItemResult[] = [];

    for (const item of dto.listings) {
      const reason = validatePushedListing(item.listing);
      if (reason) {
        results.push({
          sourceListingId: item.sourceListingId,
          status: 'rejected',
          reason,
        });
        continue;
      }

      const data: PushListingJobData = {
        sourceListingId: item.sourceListingId,
        storeId: dto.storeId,
        listing: item.listing,
        hints: item.hints,
      };
      await this.ingestionQueue.add(PUSH_JOB_NAME, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
      });
      const queued: PushListingStatusRecord = {
        status: 'queued',
        at: new Date().toISOString(),
      };
      await client.set(
        pushStatusKey(dto.storeId, item.sourceListingId),
        JSON.stringify(queued),
        { EX: PUSH_STATUS_TTL_SECONDS },
      );
      results.push({ sourceListingId: item.sourceListingId, status: 'queued' });
    }

    this.logger.log(
      `RealTrack push for ${seller.name}: ${results.filter((r) => r.status === 'queued').length}/${results.length} queued`,
    );
    return { storeId: dto.storeId, seller: seller.name, results };
  }

  /**
   * Take pushed listings off sale. Scoped to the seller that owns `storeId`, so
   * one store's key holder cannot end another seller's offers by guessing ids.
   */
  async end(dto: EndListingsDto) {
    const seller = await this.sellerForStore(dto.storeId);
    const client = await this.ingestionQueue.client;
    const results: Array<{
      sourceListingId: string;
      status: 'ended' | 'not_found';
    }> = [];

    for (const sourceListingId of dto.sourceListingIds) {
      const offers = await this.prisma.sellerOffer.findMany({
        where: {
          sellerId: seller.id,
          externalOfferId: pushListingId(dto.storeId, sourceListingId),
        },
        select: { id: true, canonicalPartId: true, status: true },
      });
      if (offers.length === 0) {
        results.push({ sourceListingId, status: 'not_found' });
        continue;
      }

      await this.prisma.sellerOffer.updateMany({
        where: { id: { in: offers.map((o) => o.id) } },
        data: { status: 'INACTIVE' },
      });
      for (const partId of new Set(offers.map((o) => o.canonicalPartId))) {
        await this.searchOutbox.enqueue(partId, 'UPSERT', 'RT_PUSH_END');
      }
      const ended: PushListingStatusRecord = {
        status: 'ended',
        at: new Date().toISOString(),
      };
      await client.set(
        pushStatusKey(dto.storeId, sourceListingId),
        JSON.stringify(ended),
        { EX: PUSH_STATUS_TTL_SECONDS },
      );
      results.push({ sourceListingId, status: 'ended' });
    }

    return { storeId: dto.storeId, seller: seller.name, results };
  }

  /** Processing state (Redis) joined with what is actually in the catalog. */
  async status(storeId: string, sourceListingId: string) {
    const seller = await this.sellerForStore(storeId);
    const client = await this.ingestionQueue.client;
    const raw = await client.get(pushStatusKey(storeId, sourceListingId));
    const record: PushListingStatusRecord | null = raw
      ? (JSON.parse(raw) as PushListingStatusRecord)
      : null;

    const offer = await this.prisma.sellerOffer.findFirst({
      where: {
        sellerId: seller.id,
        externalOfferId: pushListingId(storeId, sourceListingId),
      },
      select: {
        id: true,
        status: true,
        price: true,
        currency: true,
        canonicalPart: { select: { id: true, slug: true } },
      },
    });

    const slug = offer?.canonicalPart.slug ?? null;
    return {
      sourceListingId,
      status: record?.status ?? (offer ? 'imported' : 'unknown'),
      outcome: record?.outcome ?? null,
      error: record?.error ?? null,
      updatedAt: record?.at ?? null,
      offer: offer
        ? {
            id: offer.id,
            status: offer.status,
            price: offer.price,
            currency: offer.currency,
          }
        : null,
      part: offer
        ? {
            id: offer.canonicalPart.id,
            slug,
            // The slug is assigned by the SEO slug pass, which can lag the
            // import; the link is only real once it exists.
            url: slug ? partUrl(slug) : null,
          }
        : null,
    };
  }
}
