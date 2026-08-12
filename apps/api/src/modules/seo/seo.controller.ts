/**
 * SEO endpoints consumed by the storefront's routing, sitemap, and admin.
 *
 * These are read-mostly and heavily cached at the Next layer; the two write
 * endpoints (override, regenerate) are the admin escape hatch described in
 * docs/SEO_ARCHITECTURE.md — deliberately optional, never required for a
 * listing to be fully SEO-complete.
 */

import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  buildPartSeoDocument,
  sanitizeOverrideSlug,
  seoConfig,
  type SeoOverrides,
} from '@repo/catalog-contracts';
import { PrismaService } from '../../prisma.service';
import { SeoCatalogService } from './seo-catalog.service';
import { SeoHealthService } from './seo-health.service';
import { SeoSlugService } from './seo-slug.service';

/** Fields an admin may override. Anything else in the body is ignored. */
const OVERRIDABLE_FIELDS: Array<keyof SeoOverrides> = [
  'title',
  'description',
  'h1',
  'slug',
  'canonicalUrl',
  'robots',
  'ogImageUrl',
  'breadcrumbLabel',
  'note',
];

@Controller('seo')
export class SeoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slugs: SeoSlugService,
    private readonly catalog: SeoCatalogService,
    private readonly health: SeoHealthService,
  ) {}

  /**
   * Resolve a `/parts/<segment>` URL.
   *
   * The storefront calls this before rendering: a `redirectToSlug` in the
   * response means issue a 301, its absence means render. Keeping the decision
   * here rather than in the frontend means the redirect rules are the same for
   * any client (the buyer app today, a native app or an edge worker later).
   */
  @Get('resolve/:idOrSlug')
  async resolve(@Param('idOrSlug') idOrSlug: string) {
    const resolved = await this.slugs.resolve(idOrSlug);
    if (!resolved) throw new NotFoundException(`No part for "${idOrSlug}"`);
    return resolved;
  }

  /** Total indexable parts and how many sitemap chunks that needs. */
  @Get('sitemap/summary')
  async sitemapSummary() {
    const [total, chunks, taxonomy] = await Promise.all([
      this.catalog.countIndexableParts(),
      this.catalog.partSitemapChunkCount(),
      this.catalog.listTaxonomy(),
    ]);
    const indexableTaxonomy = taxonomy.filter((node) => node.indexable);
    return {
      parts: { total, chunks, pageSize: seoConfig().limits.sitemapPageSize },
      taxonomy: {
        total: taxonomy.length,
        indexable: indexableTaxonomy.length,
        byKind: indexableTaxonomy.reduce<Record<string, number>>((acc, node) => {
          acc[node.kind] = (acc[node.kind] ?? 0) + 1;
          return acc;
        }, {}),
      },
    };
  }

  /** One numbered chunk of sitemap-eligible parts. */
  @Get('sitemap/parts')
  async sitemapParts(@Query('page') page?: string) {
    const chunk = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const items = await this.catalog.partSitemapChunk(chunk);
    return {
      page: chunk,
      items: items.map((item) => ({
        slug: item.slug,
        lastModified: item.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Taxonomy nodes with their counts and index eligibility.
   *
   * `indexableOnly` is what the sitemap uses; the storefront's landing pages
   * ask for everything, because a below-threshold node still renders (as
   * `noindex, follow`) rather than 404ing.
   */
  @Get('taxonomy')
  async taxonomy(
    @Query('kind') kind?: string,
    @Query('indexableOnly') indexableOnly?: string,
  ) {
    const nodes = await this.catalog.listTaxonomy();
    const filtered = nodes.filter((node) => {
      if (kind && node.kind !== kind) return false;
      if (indexableOnly === 'true' && !node.indexable) return false;
      return true;
    });
    return { items: filtered };
  }

  /** Resolve a taxonomy URL segment back to its catalog value. */
  @Get('taxonomy/resolve')
  async resolveTaxonomy(
    @Query('kind') kind: string,
    @Query('slug') slug: string,
    @Query('parent') parent?: string,
  ) {
    const node = await this.catalog.resolveTaxonomySlug(
      kind as never,
      slug,
      parent,
    );
    if (!node) throw new NotFoundException(`No ${kind} for "${slug}"`);
    return node;
  }

  /** Health summary over a sample of the catalog. */
  @Get('health')
  async healthReport(
    @Query('sample') sample?: string,
    @Query('offset') offset?: string,
  ) {
    const [counters, scan] = await Promise.all([
      this.health.counters(),
      this.health.scan({
        ...(sample ? { sample: Number.parseInt(sample, 10) } : {}),
        ...(offset ? { offset: Number.parseInt(offset, 10) } : {}),
      }),
    ]);
    return { counters, ...scan };
  }

  /** Full SEO document + validation for one part — the debugging view. */
  @Get('parts/:id')
  async inspectPart(@Param('id') id: string) {
    const result = await this.health.inspect(id);
    if (!result) throw new NotFoundException(`Part ${id} not found`);
    return result;
  }

  /**
   * Write admin overrides. Only whitelisted keys are stored, and a `slug`
   * override is sanitised but *not* applied here — moving a live URL is a
   * separate, explicit action via `regenerate`, so an accidental save cannot
   * silently break inbound links.
   */
  @Post('parts/:id/overrides')
  async setOverrides(@Param('id') id: string, @Body() body: Partial<SeoOverrides>) {
    const existing = await this.prisma.canonicalPart.findUnique({
      where: { id },
      select: { seo: true },
    });
    if (!existing) throw new NotFoundException(`Part ${id} not found`);

    const current = (existing.seo as SeoOverrides | null) ?? {};
    const next: SeoOverrides = { ...current };

    for (const field of OVERRIDABLE_FIELDS) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null || value === '') {
        delete next[field];
        continue;
      }
      if (field === 'slug') {
        const sanitized = sanitizeOverrideSlug(value);
        if (sanitized) next.slug = sanitized;
        continue;
      }
      if (field === 'robots' && value !== 'index' && value !== 'noindex') continue;
      (next as Record<string, unknown>)[field] = value;
    }

    await this.prisma.canonicalPart.update({
      where: { id },
      data: { seo: next as never },
    });

    const result = await this.health.inspect(id);
    return { overrides: next, document: result?.document, report: result?.report };
  }

  /**
   * Deliberately move a part's canonical URL, retiring the old slug so it
   * 301s. This is the only supported way to change a published URL.
   */
  @Post('parts/:id/regenerate-slug')
  async regenerateSlug(
    @Param('id') id: string,
    @Body() body: { slug?: string; reason?: string },
  ) {
    const assignment = await this.slugs.regenerateSlug(id, {
      ...(body?.slug ? { slug: body.slug } : {}),
      ...(body?.reason ? { reason: body.reason } : {}),
    });
    if (!assignment) throw new NotFoundException(`Part ${id} not found`);
    this.catalog.invalidate();
    return assignment;
  }

  /** Drop cached taxonomy/sitemap aggregates after a bulk import. */
  @Post('cache/invalidate')
  invalidate() {
    this.catalog.invalidate();
    return { ok: true };
  }

  /** Echo the resolved SEO configuration — used to verify env in a container. */
  @Get('config')
  config() {
    const config = seoConfig();
    return {
      siteName: config.siteName,
      siteUrl: config.siteUrl,
      origin: config.origin,
      basePath: config.basePath,
      indexingEnabled: config.indexingEnabled,
      limits: config.limits,
      thresholds: config.thresholds,
    };
  }
}

/** Re-exported so the storefront can share the document type. */
export type { SeoOverrides };
export { buildPartSeoDocument };
