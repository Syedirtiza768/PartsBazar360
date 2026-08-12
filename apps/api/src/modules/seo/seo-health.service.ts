/**
 * SEO observability.
 *
 * Answers "is the SEO of this catalog correct?" as a query rather than as a
 * manual audit. It runs the same `validatePartSeo` the unit tests run, over
 * live rows, so a rule that holds in tests is verifiable in production and a
 * drift between them is visible rather than assumed.
 *
 * Sampled by default. A full pass over a million parts is a batch job, not an
 * HTTP request; the sample is large enough to surface systemic problems (a
 * whole import missing images, a category producing duplicate slugs) which is
 * what this is for. `scope=all` exists for the CLI.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildPartSeoDocument,
  findDuplicates,
  summarizeHealth,
  validatePartSeo,
  type SeoHealthReport,
  type SeoIssue,
  type SeoOverrides,
  type SeoPartInput,
} from '@repo/catalog-contracts';
import { PrismaService } from '../../prisma.service';

/** Everything the engine needs to judge a part, in one query. */
const HEALTH_INCLUDE = {
  offers: {
    where: { status: 'ACTIVE' },
    include: { seller: { select: { name: true, onboardingStatus: true } } },
  },
  media: { orderBy: { sortOrder: 'asc' as const } },
  fitments: {
    include: {
      vehicleConfig: {
        include: { generation: { include: { model: { include: { make: true } } } } },
      },
    },
  },
} as const;

export interface SeoHealthSummary {
  scanned: number;
  healthy: number;
  warning: number;
  critical: number;
  indexable: number;
  topIssues: Array<{ code: string; count: number; severity: string }>;
  catalogIssues: SeoIssue[];
  /** The worst offenders, for a worklist. */
  worst: SeoHealthReport[];
}

@Injectable()
export class SeoHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Map a Prisma row (with relations) into the engine's part contract. */
  toSeoInput(row: any): SeoPartInput {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      brand: row.brand,
      manufacturer: row.manufacturer,
      category: row.category,
      categoryGroup: row.categoryGroup,
      partType: row.partType,
      partSource: row.partSource,
      qualityTier: row.qualityTier,
      position: row.position,
      vehicleSystem: row.vehicleSystem,
      material: row.material,
      manufacturerPartNumber: row.manufacturerPartNumber,
      genuineOemPartNumber: row.genuineOemPartNumber,
      oeNumbers: row.oeNumbers ?? [],
      imageUrls: row.imageUrls ?? [],
      media: (row.media ?? []).map((entry: any) => ({
        url: entry.url,
        altText: entry.altText,
        isPrimary: entry.isPrimary,
        sortOrder: entry.sortOrder,
      })),
      offers: (row.offers ?? []).map((offer: any) => ({
        price: offer.price,
        currency: offer.currency,
        condition: offer.condition,
        partSource: offer.partSource,
        qualityTier: offer.qualityTier,
        sellerName: offer.seller?.name ?? null,
        sellerId: offer.sellerId,
        // A suspended seller's offer is not purchasable even though the row
        // is ACTIVE, so it must not count towards availability.
        inStock: offer.seller?.onboardingStatus === 'ACTIVE',
      })),
      compatibleVehicles: (row.fitments ?? []).map((fitment: any) => ({
        make: fitment.vehicleConfig?.generation?.model?.make?.name ?? null,
        model: fitment.vehicleConfig?.generation?.model?.name ?? null,
        startYear: fitment.vehicleConfig?.generation?.startYear ?? null,
        endYear: fitment.vehicleConfig?.generation?.endYear ?? null,
      })),
      itemSpecifics: (row.itemSpecifics as Record<string, unknown> | null) ?? null,
      seo: (row.seo as SeoOverrides | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Health for one part, including its rendered document for inspection. */
  async inspect(partId: string): Promise<{
    report: SeoHealthReport;
    document: ReturnType<typeof buildPartSeoDocument>;
  } | null> {
    const row = await this.prisma.canonicalPart.findUnique({
      where: { id: partId },
      include: HEALTH_INCLUDE,
    });
    if (!row) return null;
    const part = this.toSeoInput(row);
    const document = buildPartSeoDocument(part);
    return { report: validatePartSeo(part, document), document };
  }

  /**
   * Scan the catalog and summarise. `sample` bounds the work; `offset` lets a
   * CLI walk the whole catalog in pages without holding a cursor.
   */
  async scan(options: { sample?: number; offset?: number } = {}): Promise<SeoHealthSummary> {
    const take = Math.min(Math.max(options.sample ?? 500, 1), 5_000);
    const skip = Math.max(options.offset ?? 0, 0);

    const rows = await this.prisma.canonicalPart.findMany({
      include: HEALTH_INCLUDE,
      orderBy: { updatedAt: 'desc' },
      take,
      skip,
    });

    const parts = rows.map((row) => this.toSeoInput(row));
    const reports = parts.map((part) => validatePartSeo(part));
    const summary = summarizeHealth(reports);

    const catalogIssues = findDuplicates(
      parts.map((part) => ({
        id: part.id,
        slug: part.slug ?? null,
        canonical: buildPartSeoDocument(part).canonical,
      })),
    );

    return {
      scanned: summary.total,
      healthy: summary.healthy,
      warning: summary.warning,
      critical: summary.critical,
      indexable: summary.indexable,
      topIssues: summary.topIssues,
      catalogIssues,
      worst: reports
        .filter((report) => report.status !== 'healthy')
        .sort((a, b) => a.score - b.score)
        .slice(0, 25),
    };
  }

  /**
   * Cheap counters that do not need the engine — answerable entirely in SQL,
   * so they can run over the full catalog on every call rather than a sample.
   */
  async counters(): Promise<{
    totalParts: number;
    missingSlug: number;
    missingImage: number;
    noActiveOffer: number;
    retiredSlugs: number;
    withOverrides: number;
  }> {
    const [
      totalParts,
      missingSlug,
      missingImage,
      noActiveOffer,
      retiredSlugs,
      withOverrides,
    ] = await Promise.all([
      this.prisma.canonicalPart.count(),
      this.prisma.canonicalPart.count({ where: { slug: null } }),
      this.prisma.canonicalPart.count({ where: { imageUrls: { isEmpty: true } } }),
      this.prisma.canonicalPart.count({
        where: { offers: { none: { status: 'ACTIVE', price: { gt: 0 } } } },
      }),
      this.prisma.canonicalPartSlug.count(),
      // `Prisma.DbNull` (SQL NULL), not `null` — a nullable Json column
      // distinguishes SQL NULL from the JSON value `null`, and plain `null`
      // is not a valid filter for it.
      this.prisma.canonicalPart.count({ where: { seo: { not: Prisma.DbNull } } }),
    ]);

    return {
      totalParts,
      missingSlug,
      missingImage,
      noActiveOffer,
      retiredSlugs,
      withOverrides,
    };
  }
}
