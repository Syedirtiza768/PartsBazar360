/**
 * Slug lifecycle for canonical parts.
 *
 * This is the piece that makes SEO automatic for *every* entry path. Rather
 * than calling it from the listing form, the CSV importer, the eBay sync, the
 * ERP push, and the admin console — five call sites that a sixth import path
 * would silently miss — it hangs off `SearchIndexerService.indexPart`, which
 * every write path already reaches through the SearchOutbox. A part that gets
 * indexed gets a slug; there is no way to publish one that does not.
 *
 * Two invariants:
 *
 *  - **Assign once.** `ensureSlug` is a no-op for a part that already has one,
 *    so re-indexing after a title edit cannot move a ranked URL.
 *  - **Never lose a URL.** `regenerateSlug` writes the outgoing slug to
 *    `CanonicalPartSlug` before replacing it, and the resolver always answers
 *    with the part's *current* slug — so an old URL redirects in one hop no
 *    matter how many times the slug has changed.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  buildPartSlugBase,
  isReservedSlug,
  resolveUniqueSlug,
  sanitizeOverrideSlug,
  type SeoOverrides,
  type SeoPartInput,
} from '@repo/catalog-contracts';
import { PrismaService } from '../../prisma.service';

/** Fields the slug generator reads. Kept narrow so the query stays cheap. */
const SLUG_SOURCE_SELECT = {
  id: true,
  slug: true,
  title: true,
  brand: true,
  manufacturer: true,
  category: true,
  manufacturerPartNumber: true,
  genuineOemPartNumber: true,
  oeNumbers: true,
  seo: true,
} as const;

export interface SlugAssignment {
  partId: string;
  slug: string;
  created: boolean;
}

@Injectable()
export class SeoSlugService {
  private readonly logger = new Logger(SeoSlugService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shape a Prisma row into the engine's input contract.
   *
   * Fitment is deliberately *not* loaded here. A vehicle token would make the
   * slug depend on the fitment table, which is populated asynchronously after
   * import — so the slug would differ depending on whether enrichment had run
   * yet, and "assign once" would produce an arbitrary winner. Brand, part
   * name, and part number are all present at insert time.
   */
  private toSeoInput(row: {
    id: string;
    slug: string | null;
    title: string | null;
    brand: string | null;
    manufacturer: string | null;
    category: string | null;
    manufacturerPartNumber: string | null;
    genuineOemPartNumber: string | null;
    oeNumbers: string[];
    seo: unknown;
  }): SeoPartInput {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      brand: row.brand,
      manufacturer: row.manufacturer,
      category: row.category,
      manufacturerPartNumber: row.manufacturerPartNumber,
      genuineOemPartNumber: row.genuineOemPartNumber,
      oeNumbers: row.oeNumbers,
      seo: (row.seo as SeoOverrides | null) ?? null,
    };
  }

  /** True when the slug belongs to a different part, current or retired. */
  private async isTaken(candidate: string, partId: string): Promise<boolean> {
    if (isReservedSlug(candidate)) return true;

    const [live, retired] = await Promise.all([
      this.prisma.canonicalPart.findUnique({
        where: { slug: candidate },
        select: { id: true },
      }),
      this.prisma.canonicalPartSlug.findUnique({
        where: { slug: candidate },
        select: { partId: true },
      }),
    ]);

    if (live && live.id !== partId) return true;
    // A retired slug still 301s somewhere; reusing it for a different part
    // would silently repoint an existing redirect at unrelated inventory.
    if (retired && retired.partId !== partId) return true;
    return false;
  }

  /**
   * Assign a slug if the part does not have one. Returns the effective slug.
   *
   * Safe to call concurrently: the unique index is the real arbiter, and a
   * lost race is retried against a freshly-read row rather than overwriting.
   */
  async ensureSlug(partId: string): Promise<SlugAssignment | null> {
    const row = await this.prisma.canonicalPart.findUnique({
      where: { id: partId },
      select: SLUG_SOURCE_SELECT,
    });
    if (!row) return null;
    if (row.slug) return { partId, slug: row.slug, created: false };

    const input = this.toSeoInput(row);
    // An admin-supplied slug is honoured, but still uniqueness-checked — an
    // override may not silently take a URL that belongs to another listing.
    const override = sanitizeOverrideSlug(input.seo?.slug);
    const base = override || buildPartSlugBase(input);

    const slug = await resolveUniqueSlug(base, partId, (candidate) =>
      this.isTaken(candidate, partId),
    );

    try {
      await this.prisma.canonicalPart.update({
        where: { id: partId },
        data: { slug, slugAssignedAt: new Date() },
      });
      return { partId, slug, created: true };
    } catch (error: unknown) {
      // P2002: another worker won the race for this exact slug. Re-read; if
      // that worker was assigning to *this* part we are already done.
      if ((error as { code?: string })?.code === 'P2002') {
        const current = await this.prisma.canonicalPart.findUnique({
          where: { id: partId },
          select: { slug: true },
        });
        if (current?.slug) return { partId, slug: current.slug, created: false };
        // Different part took it — fall through to a suffixed retry.
        const retry = await resolveUniqueSlug(`${base}-alt`, partId, (candidate) =>
          this.isTaken(candidate, partId),
        );
        await this.prisma.canonicalPart.update({
          where: { id: partId },
          data: { slug: retry, slugAssignedAt: new Date() },
        });
        return { partId, slug: retry, created: true };
      }
      throw error;
    }
  }

  /**
   * Attach canonical slugs to a page of search results.
   *
   * Search results come out of OpenSearch, whose mapping is `dynamic: strict`
   * — adding a `slug` field there would require a mapping change plus a full
   * reindex of the live catalog before a single tile could link correctly.
   * A primary-key `IN` lookup over one page (≤200 ids) is a few milliseconds
   * and works for documents indexed before this feature existed, so result
   * tiles link to canonical URLs from the moment the backfill runs.
   *
   * Mutates in place and returns the same array, so callers can drop it into
   * an existing pipeline without reshaping the response.
   */
  async attachSlugs<T extends { id?: string; slug?: string | null }>(
    items: T[],
  ): Promise<T[]> {
    const ids = items
      .map((item) => item?.id)
      .filter((id): id is string => Boolean(id));
    if (!ids.length) return items;

    try {
      const rows = await this.prisma.canonicalPart.findMany({
        where: { id: { in: ids } },
        select: { id: true, slug: true },
      });
      const bySlug = new Map(rows.map((row) => [row.id, row.slug]));
      for (const item of items) {
        if (item?.id) item.slug = bySlug.get(item.id) ?? null;
      }
    } catch (error) {
      // A slug lookup failure must not fail the search request; tiles fall
      // back to the legacy id URL, which still resolves (via a 301).
      this.logger.warn(`Slug hydration failed: ${(error as Error).message}`);
    }
    return items;
  }

  /** Batch variant for the backfill CLI. Failures are logged, never fatal. */
  async ensureSlugs(partIds: string[]): Promise<SlugAssignment[]> {
    const results: SlugAssignment[] = [];
    for (const partId of partIds) {
      try {
        const assignment = await this.ensureSlug(partId);
        if (assignment) results.push(assignment);
      } catch (error) {
        this.logger.error(
          `Slug assignment failed for ${partId}: ${(error as Error).message}`,
        );
      }
    }
    return results;
  }

  /**
   * Deliberately change a part's canonical URL.
   *
   * The only supported way to move a slug. The outgoing slug is retired to
   * history first, so the old URL keeps resolving; because history rows point
   * at the *part*, not at the replacing slug, a second regeneration does not
   * create a chain — every historical URL still resolves in one hop.
   */
  async regenerateSlug(
    partId: string,
    options: { reason?: string; slug?: string } = {},
  ): Promise<SlugAssignment | null> {
    const row = await this.prisma.canonicalPart.findUnique({
      where: { id: partId },
      select: SLUG_SOURCE_SELECT,
    });
    if (!row) return null;

    const input = this.toSeoInput(row);
    const requested = sanitizeOverrideSlug(options.slug ?? input.seo?.slug);
    const base = requested || buildPartSlugBase({ ...input, slug: null });

    const next = await resolveUniqueSlug(base, partId, (candidate) =>
      this.isTaken(candidate, partId),
    );
    if (next === row.slug) return { partId, slug: next, created: false };

    await this.prisma.$transaction(async (tx) => {
      if (row.slug) {
        // upsert, not create: the slug may already be in history if it was
        // previously retired and later re-assigned to this same part.
        await tx.canonicalPartSlug.upsert({
          where: { slug: row.slug },
          create: {
            slug: row.slug,
            partId,
            reason: options.reason ?? 'slug regenerated',
          },
          update: { partId, reason: options.reason ?? 'slug regenerated' },
        });
      }
      // If the incoming slug is one this part used before, drop the stale
      // history row so it does not redirect to itself.
      await tx.canonicalPartSlug.deleteMany({ where: { slug: next } });
      await tx.canonicalPart.update({
        where: { id: partId },
        data: { slug: next, slugAssignedAt: new Date() },
      });
    });

    this.logger.log(`Slug ${row.slug ?? '(none)'} → ${next} for part ${partId}`);
    return { partId, slug: next, created: true };
  }

  /**
   * Resolve an inbound URL segment to a part.
   *
   * Handles all three cases a live site sees: the current slug (serve),
   * a retired slug (301 to current), and a legacy UUID (301 to current).
   * `CanonicalPartRedirect` is also consulted so a part merged into another
   * resolves to the surviving part — again in one hop, because it resolves
   * the *target's* slug rather than the target's URL.
   */
  async resolve(idOrSlug: string): Promise<{
    id: string;
    slug: string | null;
    /** Set when the caller must issue a 301 to this slug. */
    redirectToSlug?: string;
    reason?: 'retired-slug' | 'legacy-id' | 'merged';
  } | null> {
    const value = String(idOrSlug || '').trim();
    if (!value) return null;

    const bySlug = await this.prisma.canonicalPart.findUnique({
      where: { slug: value },
      select: { id: true, slug: true },
    });
    if (bySlug) return { id: bySlug.id, slug: bySlug.slug };

    // A UUID-shaped segment is the legacy /part/<id> URL.
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (isUuid) {
      const byId = await this.prisma.canonicalPart.findUnique({
        where: { id: value },
        select: { id: true, slug: true },
      });
      if (byId) {
        // Assign on demand: a part that predates the backfill still gets a
        // canonical URL the first time anyone (or any crawler) asks for it.
        const slug = byId.slug ?? (await this.ensureSlug(byId.id))?.slug ?? null;
        return {
          id: byId.id,
          slug,
          ...(slug ? { redirectToSlug: slug, reason: 'legacy-id' as const } : {}),
        };
      }

      const merged = await this.prisma.canonicalPartRedirect.findUnique({
        where: { fromPartId: value },
        select: { toPart: { select: { id: true, slug: true } } },
      });
      if (merged?.toPart) {
        const slug =
          merged.toPart.slug ?? (await this.ensureSlug(merged.toPart.id))?.slug ?? null;
        return {
          id: merged.toPart.id,
          slug,
          ...(slug ? { redirectToSlug: slug, reason: 'merged' as const } : {}),
        };
      }
      return null;
    }

    const retired = await this.prisma.canonicalPartSlug.findUnique({
      where: { slug: value },
      select: { part: { select: { id: true, slug: true } } },
    });
    if (retired?.part?.slug) {
      return {
        id: retired.part.id,
        slug: retired.part.slug,
        redirectToSlug: retired.part.slug,
        reason: 'retired-slug',
      };
    }

    return null;
  }
}
