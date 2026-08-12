/**
 * The single place that turns a canonical part into a search document and
 * writes it to the v2 index (brief §19, §29 "do not duplicate canonical
 * product and fitment logic across multiple services").
 *
 * Today four call sites each hand-build a different `indexPart` payload
 * (`uploads.service.ts`, three in `ingestion.processor.ts`, plus a CLI), so a
 * part's indexed shape depends on which code path touched it last. Here the
 * caller supplies only an id; this service loads the part and builds the
 * document, so every write produces an identical shape.
 *
 * Writes to the `parts_search` alias when it has been promoted, otherwise to
 * the physical v2 index — so this runs correctly both before and after the
 * alias swap. The legacy `OpenSearchService.indexPart` path is left untouched
 * and keeps maintaining the old index during the transition.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { PrismaService } from '../../../prisma.service';
import { SeoSlugService } from '../../seo/seo-slug.service';
import { buildSearchDocument } from './search-document.builder';
import {
  SEARCH_ALIAS,
  SEARCH_INDEX_VERSION,
  physicalIndexName,
} from './search-index.schema';

export type IndexOutcome = 'INDEXED' | 'DELETED' | 'MISSING';

@Injectable()
export class SearchIndexerService {
  private readonly logger = new Logger(SearchIndexerService.name);
  private readonly client: Client;
  private cachedTarget?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly seoSlugs: SeoSlugService,
  ) {
    this.client = new Client({
      node: process.env.OPENSEARCH_URL || 'http://opensearch:9200',
    });
  }

  /** Alias if promoted, else the physical v2 index. Cached after first probe. */
  async target(): Promise<string> {
    if (this.cachedTarget) return this.cachedTarget;
    try {
      const response = await this.client.indices.existsAlias({ name: SEARCH_ALIAS });
      if (Boolean((response as any)?.body ?? response)) {
        this.cachedTarget = SEARCH_ALIAS;
        return this.cachedTarget;
      }
    } catch {
      /* fall through */
    }
    this.cachedTarget = physicalIndexName(SEARCH_INDEX_VERSION);
    return this.cachedTarget;
  }

  /** Load a part with everything the document builder needs. */
  private loadPart(id: string) {
    return this.prisma.canonicalPart.findUnique({
      where: { id },
      include: {
        offers: {
          where: { status: 'ACTIVE' },
          include: { seller: { select: { name: true, onboardingStatus: true } } },
        },
        fitments: {
          select: { vehicleConfigId: true, evidenceLevel: true, confidence: true },
        },
      },
    });
  }

  /**
   * Index one part by id.
   *
   * Idempotent: the document id is the part id, so a retry overwrites rather
   * than duplicating. A part with no buyer-visible offer is *deleted* from the
   * index rather than left stale — which is how a suspended seller or a
   * sold-out listing stops appearing.
   *
   * Throws on transport failure so the caller can retry. This is the crucial
   * difference from `OpenSearchService.indexPart`, which swallows every error
   * and lets the outbox row be marked DONE for a write that never happened.
   */
  async indexPart(id: string): Promise<IndexOutcome> {
    // Slug assignment rides on indexing rather than on the write paths.
    // Every path that creates or changes a part — listing form, CSV import,
    // eBay sync, ERP push, bulk SQL + outbox row — reaches this method, so a
    // part cannot become buyer-visible without a canonical URL, and a future
    // import path inherits that for free. Assignment is idempotent and a
    // no-op once the part has a slug.
    //
    // A slug failure must not block indexing: a part missing from search is a
    // worse outcome than a part missing a slug, and the outbox will retry.
    try {
      await this.seoSlugs.ensureSlug(id);
    } catch (error) {
      this.logger.warn(
        `Slug assignment failed for ${id}, indexing anyway: ${(error as Error).message}`,
      );
    }

    const part = await this.loadPart(id);
    if (!part) {
      await this.removePart(id);
      return 'MISSING';
    }

    const document = buildSearchDocument({
      ...part,
      compatibility: Array.isArray(part.compatibility) ? part.compatibility : [],
      offers: part.offers.map((offer: any) => ({
        ...offer,
        sellerName: offer.seller?.name ?? null,
        sellerOnboardingStatus: offer.seller?.onboardingStatus ?? null,
      })),
    });

    if (!document) {
      await this.removePart(id);
      return 'DELETED';
    }

    await this.client.index({
      index: await this.target(),
      id: document.id,
      body: document as Record<string, unknown>,
      refresh: process.env.OPENSEARCH_REFRESH_ON_INDEX === 'true',
    });
    return 'INDEXED';
  }

  /** Remove a part from the index. A 404 is success — it is already absent. */
  async removePart(id: string): Promise<void> {
    try {
      await this.client.delete({ index: await this.target(), id });
    } catch (error: any) {
      const status = error?.meta?.statusCode ?? error?.statusCode;
      if (status !== 404) throw error;
    }
  }

  /** Index many parts, returning per-id outcomes. Used by the outbox drain. */
  async indexMany(ids: string[]): Promise<Map<string, IndexOutcome | Error>> {
    const results = new Map<string, IndexOutcome | Error>();
    for (const id of ids) {
      try {
        results.set(id, await this.indexPart(id));
      } catch (error: any) {
        results.set(id, error instanceof Error ? error : new Error(String(error)));
      }
    }
    return results;
  }
}
