/**
 * Catalog-side SEO queries: which URLs exist, which are indexable, and what
 * each taxonomy node contains.
 *
 * Everything here answers from the database rather than from a maintained
 * list, which is what makes new inventory self-publishing: a listing inserted
 * by any path shows up in the next sitemap fetch and in its taxonomy pages'
 * counts without a rebuild, a config change, or a deploy.
 *
 * The queries are written for a catalog of 10^6 rows: keyset pagination
 * instead of OFFSET, aggregate counts instead of loading rows, and a short
 * in-process cache on the taxonomy aggregation because it is the one query
 * that is expensive and identical for every caller.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  decideTaxonomyIndexability,
  seoConfig,
  taxonomySlug,
  type SeoTaxonomyInput,
  type SeoTaxonomyKind,
} from '@repo/catalog-contracts';
import { PrismaService } from '../../prisma.service';

/**
 * The condition a part must meet to be a *candidate* for indexing, expressed
 * as SQL so a million-row catalog never has to be loaded into Node to be
 * counted. It is deliberately a subset of the full engine rule
 * (`decidePartIndexability`): SQL can cheaply check "live, priced, in stock,
 * has an image", and the engine applies the content-quality checks on top.
 *
 * The consequence is that this predicate over-selects slightly — a part it
 * accepts may still end up noindex. Sitemap generation re-checks each part
 * through the engine before emitting it, so the sitemap never advertises a
 * noindex URL; the SQL predicate only has to be a cheap, safe superset.
 */
const INDEXABLE_PART_WHERE = {
  slug: { not: null },
  imageUrls: { isEmpty: false },
  offers: {
    some: {
      status: 'ACTIVE',
      price: { gt: 0 },
      seller: { onboardingStatus: 'ACTIVE' },
    },
  },
} as const;

export interface SitemapPartEntry {
  id: string;
  slug: string;
  updatedAt: Date;
}

export interface TaxonomyNodeSummary {
  kind: SeoTaxonomyKind;
  name: string;
  slug: string;
  productCount: number;
  parents?: Array<{ kind: SeoTaxonomyKind; name: string }>;
  year?: number;
  indexable: boolean;
  updatedAt?: Date;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class SeoCatalogService {
  private readonly logger = new Logger(SeoCatalogService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  /**
   * Taxonomy aggregates change on the timescale of an import, not a request.
   * Ten minutes keeps sitemap and landing-page counts fresh enough while
   * collapsing a burst of crawler requests into one aggregation.
   */
  private readonly cacheTtlMs = Number(process.env.SEO_CACHE_TTL_MS || 600_000);

  constructor(private readonly prisma: PrismaService) {}

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const value = await load();
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
    return value;
  }

  /** Drop cached aggregates — called after a bulk import or a backfill. */
  invalidate(): void {
    this.cache.clear();
  }

  /** Total number of sitemap-candidate parts. */
  async countIndexableParts(): Promise<number> {
    return this.cached('count:parts', () =>
      this.prisma.canonicalPart.count({ where: INDEXABLE_PART_WHERE }),
    );
  }

  /**
   * One page of sitemap-candidate parts.
   *
   * Ordered by `(updatedAt, id)` and paged by cursor rather than OFFSET:
   * `OFFSET 900000` makes Postgres walk 900 000 rows to discard them, which
   * is what turns the last sitemap chunk of a large catalog into a timeout.
   */
  async listIndexableParts(options: {
    limit: number;
    cursorUpdatedAt?: Date;
    cursorId?: string;
  }): Promise<SitemapPartEntry[]> {
    const { limit, cursorUpdatedAt, cursorId } = options;

    const rows = await this.prisma.canonicalPart.findMany({
      where: {
        ...INDEXABLE_PART_WHERE,
        ...(cursorUpdatedAt && cursorId
          ? {
              OR: [
                { updatedAt: { gt: cursorUpdatedAt } },
                { updatedAt: cursorUpdatedAt, id: { gt: cursorId } },
              ],
            }
          : {}),
      },
      select: { id: true, slug: true, updatedAt: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    return rows
      .filter((row): row is typeof row & { slug: string } => Boolean(row.slug))
      .map((row) => ({ id: row.id, slug: row.slug, updatedAt: row.updatedAt }));
  }

  /**
   * The `(updatedAt, id)` of the **last** row of each sitemap chunk.
   *
   * A crawler requests `parts-7.xml` with no cursor to hand, so chunk N has to
   * be addressable by number. Walking the keyset N times to get there is N
   * queries — 200 of them for the last chunk of a million-row catalog, on
   * every crawl. Instead one windowed scan computes every chunk boundary at
   * once and caches them; each chunk fetch is then a single bounded keyset
   * read whose exclusive `>` predicate starts exactly where the previous
   * chunk ended.
   */
  private async chunkBoundaries(): Promise<Array<{ updatedAt: Date; id: string }>> {
    return this.cached('sitemap:cursors', async () => {
      const size = seoConfig().limits.sitemapPageSize;
      const rows = await this.prisma.$queryRaw<
        Array<{ updatedAt: Date; id: string }>
      >`
        SELECT "updatedAt", "id"
        FROM (
          SELECT cp."updatedAt",
                 cp."id",
                 ROW_NUMBER() OVER (ORDER BY cp."updatedAt", cp."id") AS rn
          FROM "CanonicalPart" cp
          WHERE cp."slug" IS NOT NULL
            AND array_length(cp."imageUrls", 1) > 0
            AND EXISTS (
              SELECT 1 FROM "SellerOffer" so
              JOIN "Seller" s ON s."id" = so."sellerId"
              WHERE so."canonicalPartId" = cp."id"
                AND so."status" = 'ACTIVE'
                AND so."price" > 0
                AND s."onboardingStatus" = 'ACTIVE'
            )
        ) ranked
        WHERE ranked.rn % ${size}::bigint = 0
        ORDER BY ranked.rn
      `;
      return rows;
    });
  }

  /**
   * One numbered sitemap chunk. `page` is 1-based to match the URL.
   *
   * Chunk membership is stable between crawls as long as the catalog does not
   * churn, which is what lets Google fetch only the chunks whose `lastmod`
   * moved instead of re-reading the whole set.
   */
  async partSitemapChunk(page: number): Promise<SitemapPartEntry[]> {
    const size = seoConfig().limits.sitemapPageSize;
    const target = Math.max(1, Math.floor(page));

    const boundaries = await this.chunkBoundaries();
    // `boundaries[i]` closes chunk i+1, so chunk 1 needs no cursor and chunk N
    // resumes immediately after the boundary that closed chunk N-1. Requesting
    // a chunk past the last boundary+1 is simply empty.
    if (target > boundaries.length + 1) return [];

    const previous = target > 1 ? boundaries[target - 2] : undefined;

    return this.listIndexableParts({
      limit: size,
      ...(previous
        ? { cursorUpdatedAt: previous.updatedAt, cursorId: previous.id }
        : {}),
    });
  }

  /**
   * How many part sitemap files the current catalog needs.
   *
   * Derived from the exact row count rather than from the boundary list, so a
   * catalog that divides evenly into chunks does not advertise a trailing
   * empty file.
   */
  async partSitemapChunkCount(): Promise<number> {
    const size = seoConfig().limits.sitemapPageSize;
    const total = await this.countIndexableParts();
    return Math.max(1, Math.ceil(total / size));
  }

  /**
   * Category, category-group, and brand nodes with their indexable-listing
   * counts. One `groupBy` per dimension — no per-node query, so adding a
   * thousand new categories costs nothing extra.
   */
  async listFlatTaxonomy(): Promise<TaxonomyNodeSummary[]> {
    return this.cached('taxonomy:flat', async () => {
      const [categories, groups, brands] = await Promise.all([
        this.prisma.canonicalPart.groupBy({
          by: ['category'],
          where: { ...INDEXABLE_PART_WHERE, category: { not: null } },
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        this.prisma.canonicalPart.groupBy({
          by: ['categoryGroup'],
          where: { ...INDEXABLE_PART_WHERE, categoryGroup: { not: null } },
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        this.prisma.canonicalPart.groupBy({
          by: ['brand'],
          where: { ...INDEXABLE_PART_WHERE, brand: { not: null } },
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
      ]);

      const build = (
        kind: SeoTaxonomyKind,
        rows: Array<{
          _count: { _all: number };
          _max: { updatedAt: Date | null };
          [key: string]: unknown;
        }>,
        field: string,
      ): TaxonomyNodeSummary[] =>
        rows
          .map((row) => {
            const name = String(row[field] ?? '').trim();
            const productCount = row._count._all;
            const node: SeoTaxonomyInput = { kind, name, productCount };
            return {
              kind,
              name,
              slug: taxonomySlug(name),
              productCount,
              indexable: decideTaxonomyIndexability(node).robots.index,
              ...(row._max.updatedAt ? { updatedAt: row._max.updatedAt } : {}),
            };
          })
          .filter((node) => node.name && node.slug)
          .sort((a, b) => b.productCount - a.productCount);

      return [
        ...build('category', categories, 'category'),
        ...build('categoryGroup', groups, 'categoryGroup'),
        ...build('brand', brands, 'brand'),
      ];
    });
  }

  /**
   * Vehicle make/model nodes, counted through the fitment graph.
   *
   * Raw SQL because this is a three-table join with a DISTINCT part count, and
   * expressing it through the query builder would either load rows into Node
   * or issue one query per make. `$queryRaw` keeps it a single aggregate.
   */
  async listVehicleTaxonomy(): Promise<TaxonomyNodeSummary[]> {
    return this.cached('taxonomy:vehicles', async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{
          make: string;
          model: string | null;
          product_count: bigint;
          updated_at: Date | null;
        }>
      >`
        SELECT
          vmk."name"                       AS make,
          vm."name"                        AS model,
          COUNT(DISTINCT cp."id")          AS product_count,
          MAX(cp."updatedAt")              AS updated_at
        FROM "CanonicalPart" cp
        JOIN "Fitment" f              ON f."canonicalPartId" = cp."id"
        JOIN "VehicleConfiguration" vc ON vc."id" = f."vehicleConfigId"
        JOIN "VehicleGeneration" vg   ON vg."id" = vc."generationId"
        JOIN "VehicleModel" vm        ON vm."id" = vg."modelId"
        JOIN "VehicleMake" vmk        ON vmk."id" = vm."makeId"
        WHERE cp."slug" IS NOT NULL
          AND array_length(cp."imageUrls", 1) > 0
          AND EXISTS (
            SELECT 1 FROM "SellerOffer" so
            JOIN "Seller" s ON s."id" = so."sellerId"
            WHERE so."canonicalPartId" = cp."id"
              AND so."status" = 'ACTIVE'
              AND so."price" > 0
              AND s."onboardingStatus" = 'ACTIVE'
          )
        GROUP BY GROUPING SETS ((vmk."name"), (vmk."name", vm."name"))
      `;

      return rows
        .map((row) => {
          const isModel = Boolean(row.model);
          const kind: SeoTaxonomyKind = isModel ? 'model' : 'make';
          const name = String(isModel ? row.model : row.make).trim();
          const productCount = Number(row.product_count);
          const parents = isModel
            ? [{ kind: 'make' as SeoTaxonomyKind, name: row.make }]
            : undefined;
          const node: SeoTaxonomyInput = {
            kind,
            name,
            productCount,
            ...(parents ? { parents } : {}),
          };
          return {
            kind,
            name,
            slug: taxonomySlug(name),
            productCount,
            ...(parents ? { parents } : {}),
            indexable: decideTaxonomyIndexability(node).robots.index,
            ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
          };
        })
        .filter((node) => node.name && node.slug)
        .sort((a, b) => b.productCount - a.productCount);
    });
  }

  /** Every taxonomy node, flat + vehicle. */
  async listTaxonomy(): Promise<TaxonomyNodeSummary[]> {
    const [flat, vehicles] = await Promise.all([
      this.listFlatTaxonomy(),
      this.listVehicleTaxonomy().catch((error) => {
        // A fitment-graph failure must not take the whole sitemap down —
        // category and brand pages are still perfectly serviceable.
        this.logger.error(`Vehicle taxonomy query failed: ${(error as Error).message}`);
        return [] as TaxonomyNodeSummary[];
      }),
    ]);
    return [...flat, ...vehicles];
  }

  /**
   * Resolve a URL slug back to the catalog value it came from.
   *
   * Facet values are computed, not rows, so there is no slug column to look
   * up. Matching against the live node list is exact (both sides use the same
   * `taxonomySlug`) and cheap, since the list is cached.
   */
  async resolveTaxonomySlug(
    kind: SeoTaxonomyKind,
    slug: string,
    parentSlug?: string,
  ): Promise<TaxonomyNodeSummary | null> {
    const nodes = await this.listTaxonomy();
    const wanted = String(slug || '').toLowerCase();

    return (
      nodes.find((node) => {
        if (node.kind !== kind) return false;
        if (node.slug !== wanted) return false;
        if (!parentSlug) return true;
        const parent = node.parents?.[0];
        return Boolean(parent && taxonomySlug(parent.name) === parentSlug.toLowerCase());
      }) ?? null
    );
  }
}
