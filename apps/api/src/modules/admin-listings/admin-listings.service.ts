import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { OpenSearchService } from '../search/opensearch.service';
import { SearchOutboxService } from '../search/index/search-outbox.service';
import { BuyerCacheService } from '../search/buyer-cache.service';
import { SeoSlugService } from '../seo/seo-slug.service';
import { resolvePartClassKey } from '../checkout/part-class-weights';
import {
  normalizeMasterName,
  normalizePartNumber,
} from '../catalog-import/part-normalization.util';
import type {
  AdminListingQueryDto,
  CreateAdminListingDto,
  UpdateAdminListingDto,
} from './admin-listings.dto';

const OEM_PART_TYPES = new Set([
  'GENUINE_OEM',
  'OEM_EQUIVALENT',
  'SALVAGE_OEM',
]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LISTING_INCLUDE = {
  seller: { select: { id: true, name: true } },
  canonicalPart: {
    select: {
      id: true,
      slug: true,
      title: true,
      brand: true,
      manufacturerPartNumber: true,
      category: true,
      imageUrls: true,
      weight: true,
    },
  },
  inventory: { select: { quantity: true, status: true } },
} satisfies Prisma.SellerOfferInclude;

type ListingRecord = Prisma.SellerOfferGetPayload<{
  include: typeof LISTING_INCLUDE;
}>;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toListing(offer: ListingRecord) {
  return {
    id: offer.id,
    status: offer.status,
    price: offer.price,
    sellerBasePrice: offer.sellerBasePrice,
    currency: offer.currency,
    shippingCost: offer.shippingCost,
    condition: offer.condition,
    partType: offer.partType,
    sellerSku: offer.sellerSku,
    sourceTag: offer.sourceTag,
    quantity: offer.inventory.reduce(
      (sum, row) => sum + Math.max(0, row.quantity),
      0,
    ),
    updatedAt: offer.updatedAt,
    seller: offer.seller,
    part: {
      id: offer.canonicalPart.id,
      slug: offer.canonicalPart.slug,
      title: offer.sellerTitle || offer.canonicalPart.title,
      brand: offer.canonicalPart.brand,
      manufacturerPartNumber: offer.canonicalPart.manufacturerPartNumber,
      category: offer.canonicalPart.category,
      imageUrl: offer.canonicalPart.imageUrls[0] ?? null,
      weightKg: offer.canonicalPart.weight,
    },
  };
}

@Injectable()
export class AdminListingsService {
  private readonly logger = new Logger(AdminListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly search: OpenSearchService,
    private readonly searchOutbox: SearchOutboxService,
    private readonly buyerCache: BuyerCacheService,
    private readonly slugs: SeoSlugService,
  ) {}

  async list(query: AdminListingQueryDto) {
    const limit = query.limit ?? 25;
    const page = query.page ?? 1;
    const where = this.listingWhere(query);
    const [total, offers] = await Promise.all([
      this.prisma.sellerOffer.count({ where }),
      this.prisma.sellerOffer.findMany({
        where,
        include: LISTING_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      total,
      page,
      limit,
      hasMore: page * limit < total,
      items: offers.map(toListing),
    };
  }

  async update(
    offerId: string,
    input: UpdateAdminListingDto,
    actorId?: string,
  ) {
    const offer = await this.prisma.sellerOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer) throw new NotFoundException('Listing not found');

    const data: Prisma.SellerOfferUpdateInput = {};
    if (input.price !== undefined) {
      const price = round2(input.price);
      data.price = price;
      data.pricedAt = new Date();
      // Seller cost and proceeds are unchanged; the difference is the
      // marketplace's share at the new buyer price.
      if (offer.sellerBasePrice != null) {
        data.marketplaceFee = round2(price - offer.sellerBasePrice);
      }
    }
    if (input.shippingCost !== undefined) {
      data.shippingCost =
        input.shippingCost === null ? null : round2(input.shippingCost);
    }
    if (input.status !== undefined) data.status = input.status;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const updated = await this.prisma.sellerOffer.update({
      where: { id: offerId },
      data,
      include: LISTING_INCLUDE,
    });

    await this.audit.record({
      action: 'LISTING_UPDATED',
      entityType: 'SellerOffer',
      entityId: offerId,
      actorType: 'ADMIN',
      actorId,
      originalValue: {
        price: offer.price,
        shippingCost: offer.shippingCost,
        status: offer.status,
      },
      normalizedValue: {
        price: updated.price,
        shippingCost: updated.shippingCost,
        status: updated.status,
      },
    });

    await this.reindex(offer.canonicalPartId, 'ADMIN_LISTING_UPDATE');
    return toListing(updated);
  }

  async create(input: CreateAdminListingDto, actorId?: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: input.sellerId },
      include: { warehouses: { take: 1, orderBy: { id: 'asc' } } },
    });
    if (!seller) throw new BadRequestException('Seller not found');

    const title = input.title.trim().replace(/\s+/g, ' ');
    const brand = input.brand?.trim() || null;
    const mpn = input.manufacturerPartNumber?.trim() || null;
    const normalizedMpn = mpn ? normalizePartNumber(mpn) : '';
    const category = input.category?.trim() || null;
    const oeNumbers = Array.from(
      new Set(
        (input.oeNumbers || '')
          .split(/[,;\n]+/)
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
      ),
    ).slice(0, 50);
    const partSource = OEM_PART_TYPES.has(input.partType)
      ? 'OEM'
      : 'AFTERMARKET';
    const price = round2(input.price);
    const quantity = input.quantity;
    const status =
      quantity === 0
        ? 'OUT_OF_STOCK'
        : input.status === 'PAUSED'
          ? 'PAUSED'
          : 'ACTIVE';
    const brandMaster = brand ? await this.findBrand(brand) : null;
    const sellerSku = input.sellerSku?.trim() || mpn || null;

    const { part, offer } = await this.prisma.$transaction(async (tx) => {
      const part = await tx.canonicalPart.create({
        data: {
          title,
          normalizedTitle: title
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, ' ')
            .trim(),
          description: input.description?.trim() || null,
          brand: brandMaster?.displayName ?? brand,
          manufacturer: brandMaster?.displayName ?? brand,
          primaryBrandId: brandMaster?.id,
          manufacturerPartNumber: mpn,
          category,
          oeNumbers,
          fitmentFlags: [],
          imageUrls: input.imageUrls ?? [],
          weight: input.weightKg ?? null,
          weightSource: input.weightKg ? 'SELLER' : null,
          partClassKey: resolvePartClassKey({ title, category }),
          partSource,
          partType: input.partType,
          qualityTier: input.condition,
          classificationStatus: 'READY',
          classificationConfidence: 1,
          classificationReason: 'Created manually by an administrator',
        },
      });

      if (normalizedMpn) {
        await tx.catalogPartNumber.create({
          data: {
            canonicalPartId: part.id,
            displayNumber: mpn!,
            normalizedNumber: normalizedMpn,
            numberType: 'BRAND_MPN',
            brandId: brandMaster?.id,
            source: 'ADMIN_MANUAL',
            verificationStatus: 'SELLER_DECLARED',
            confidence: 0.9,
          },
        });
      }

      const warehouse =
        seller.warehouses[0] ??
        (await tx.warehouse.create({
          data: {
            sellerId: seller.id,
            name: `${seller.name} Default Warehouse`,
            location: 'Marketplace intake',
          },
        }));

      const offer = await tx.sellerOffer.create({
        data: {
          sellerId: seller.id,
          canonicalPartId: part.id,
          price,
          sellerBasePrice: price,
          marketplaceFee: 0,
          sellerProceeds: price,
          pricedAt: new Date(),
          currency: input.currency,
          condition: input.condition,
          partSource,
          partType: input.partType,
          qualityTier: input.condition,
          sellerSku,
          sellerTitle: title,
          externalOfferId: sellerSku,
          sourceKey: `ADMIN_MANUAL:${randomUUID()}`,
          shippingCost:
            input.shippingCost === undefined || input.shippingCost === null
              ? null
              : round2(input.shippingCost),
          status,
        },
      });

      await tx.inventory.create({
        data: {
          warehouseId: warehouse.id,
          offerId: offer.id,
          quantity,
          status: quantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
        },
      });

      return { part, offer };
    });

    await this.slugs.ensureSlug(part.id).catch((error) => {
      this.logger.warn(`Slug assignment failed for ${part.id}: ${error}`);
    });

    await this.audit.record({
      action: 'LISTING_CREATED',
      entityType: 'SellerOffer',
      entityId: offer.id,
      actorType: 'ADMIN',
      actorId,
      normalizedValue: {
        canonicalPartId: part.id,
        sellerId: seller.id,
        title,
        price,
        currency: input.currency,
        shippingCost: offer.shippingCost,
        quantity,
      },
    });

    await this.reindex(part.id, 'ADMIN_LISTING_CREATE');

    const created = await this.prisma.sellerOffer.findUniqueOrThrow({
      where: { id: offer.id },
      include: LISTING_INCLUDE,
    });
    return toListing(created);
  }

  private listingWhere(
    query: AdminListingQueryDto,
  ): Prisma.SellerOfferWhereInput {
    const search = query.search?.trim();
    const status =
      !query.status || query.status === 'ALL' ? undefined : query.status;
    return {
      status,
      sellerId: query.sellerId || undefined,
      ...(search
        ? {
            OR: [
              ...(UUID_RE.test(search)
                ? [{ id: search }, { canonicalPartId: search }]
                : []),
              { sellerSku: { contains: search, mode: 'insensitive' } },
              { sellerTitle: { contains: search, mode: 'insensitive' } },
              {
                canonicalPart: {
                  OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    {
                      manufacturerPartNumber: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
  }

  private async findBrand(brand: string) {
    const normalized = normalizeMasterName(brand);
    return this.prisma.brandMaster.findFirst({
      where: {
        OR: [
          { canonicalName: { equals: brand, mode: 'insensitive' } },
          { displayName: { equals: brand, mode: 'insensitive' } },
          { aliases: { some: { normalized } } },
        ],
      },
      select: { id: true, displayName: true },
    });
  }

  /** Same sync path as merchant inventory edits: durable outbox + live index + buyer cache. */
  private async reindex(canonicalPartId: string, reason: string) {
    try {
      await this.searchOutbox.enqueue(canonicalPartId, 'UPSERT', reason);
      const part = await this.prisma.canonicalPart.findUnique({
        where: { id: canonicalPartId },
        include: {
          offers: { include: { seller: true } },
          partNumbers: true,
        },
      });
      if (part) await this.search.indexPart(part);
    } catch (error) {
      this.logger.warn(`Reindex failed for ${canonicalPartId}: ${error}`);
    }
    void this.buyerCache.revalidatePart(canonicalPartId);
  }
}
