/**
 * Internal (staff) search for Omni Core's Parts Search portal.
 *
 * Runs the exact same v1 query path as the public `/v1/search` so ranking,
 * interpretation and facets never drift between the two, then replaces the
 * index's offer projection with the authoritative offer rows from Postgres.
 *
 * The index only carries offers a buyer may see; staff need the rest too —
 * paused/ended offers, offers hidden by the Superior priority rule, the
 * seller's store, SKU, source tag, source key and per-warehouse stock. Every
 * offer is returned with `buyerVisible` / `outrankedBySuperior` flags so the
 * portal can explain why a buyer does or does not see it.
 *
 * Reachable only through RealtrackSearchGuard; never mount this on a public
 * route.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import {
  isBuyerVisibleIndexedOffer,
  isOutrankedBySuperior,
  isSuperiorOffer,
} from '../buyer-visible-offers.util';
import {
  SearchV1Service,
  type SearchV1Response,
} from '../v1/search-v1.service';
import type { SearchQueryDto } from '../v1/search-query.dto';

/** Offers attached per search result; the part endpoint returns all of them. */
export const MAX_OFFERS_PER_RESULT = 25;

export interface InternalWarehouseStock {
  warehouseId: string;
  name: string;
  location: string | null;
  quantity: number;
  status: string;
}

export interface InternalOffer {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerStoreId: string | null;
  sellerStatus: string;
  status: string;
  price: number;
  sellerBasePrice: number | null;
  currency: string;
  condition: string;
  partSource: string;
  qualityTier: string;
  sourceTag: string | null;
  sourceKey: string | null;
  sellerSku: string | null;
  sellerTitle: string | null;
  externalOfferId: string | null;
  leadTimeDays: number | null;
  quantity: number;
  warehouses: InternalWarehouseStock[];
  /** Would a buyer see this offer at all (status, seller, price checks)? */
  buyerVisible: boolean;
  /** Hidden from buyers because Superior has an offer on the same part. */
  outrankedBySuperior: boolean;
  updatedAt: string;
}

export interface InternalSourceRecord {
  id: string;
  sellerOfferId: string | null;
  sourceType: string;
  sourcePlatform: string | null;
  externalId: string | null;
  sourceFileName: string | null;
  sourceSheet: string | null;
  sourceRowNumber: number | null;
  matchConfidence: number | null;
  importedAt: string;
  lastSyncedAt: string | null;
}

export interface InternalSearchResponse extends SearchV1Response {
  results: Array<
    Record<string, unknown> & {
      id: string;
      internalOffers: InternalOffer[];
      internalOfferCount: number;
    }
  >;
  meta: SearchV1Response['meta'] & { audience: 'internal' };
}

export const OFFER_SELECT = {
  id: true,
  sellerId: true,
  canonicalPartId: true,
  price: true,
  sellerBasePrice: true,
  currency: true,
  condition: true,
  partSource: true,
  qualityTier: true,
  status: true,
  sourceTag: true,
  sourceKey: true,
  sellerSku: true,
  sellerTitle: true,
  externalOfferId: true,
  leadTimeDays: true,
  updatedAt: true,
  seller: {
    select: { id: true, name: true, storeId: true, onboardingStatus: true },
  },
  inventory: {
    select: {
      quantity: true,
      status: true,
      warehouse: { select: { id: true, name: true, location: true } },
    },
  },
} as const;

export type OfferRow = {
  id: string;
  sellerId: string;
  canonicalPartId: string;
  price: number;
  sellerBasePrice: number | null;
  currency: string;
  condition: string;
  partSource: string;
  qualityTier: string;
  status: string;
  sourceTag: string | null;
  sourceKey: string | null;
  sellerSku: string | null;
  sellerTitle: string | null;
  externalOfferId: string | null;
  leadTimeDays: number | null;
  updatedAt: Date;
  seller: {
    id: string;
    name: string;
    storeId: string | null;
    onboardingStatus: string;
  } | null;
  inventory: Array<{
    quantity: number;
    status: string;
    warehouse: { id: string; name: string; location: string | null } | null;
  }>;
};

/** Shape one offer row and flag how buyers see it. */
export function toInternalOffers(rows: OfferRow[]): InternalOffer[] {
  const visible = rows.filter((row) =>
    isBuyerVisibleIndexedOffer({
      sellerId: row.sellerId,
      sellerName: row.seller?.name ?? null,
      status: row.status,
      price: row.price,
      seller: row.seller
        ? {
            name: row.seller.name,
            onboardingStatus: row.seller.onboardingStatus,
          }
        : null,
    }),
  );
  const visibleIds = new Set(visible.map((row) => row.id));
  const superiorPresent = visible.some((row) =>
    isSuperiorOffer({ sellerId: row.sellerId, sellerName: row.seller?.name }),
  );

  return rows
    .map((row): InternalOffer => {
      const buyerVisible = visibleIds.has(row.id);
      const outranked =
        superiorPresent &&
        isOutrankedBySuperior({
          sellerId: row.sellerId,
          sellerName: row.seller?.name,
        });
      const warehouses = row.inventory.map((item) => ({
        warehouseId: item.warehouse?.id ?? '',
        name: item.warehouse?.name ?? 'Unknown warehouse',
        location: item.warehouse?.location ?? null,
        quantity: item.quantity,
        status: item.status,
      }));
      return {
        id: row.id,
        sellerId: row.sellerId,
        sellerName: row.seller?.name ?? 'Unknown seller',
        sellerStoreId: row.seller?.storeId ?? null,
        sellerStatus: row.seller?.onboardingStatus ?? 'UNKNOWN',
        status: row.status,
        price: row.price,
        sellerBasePrice: row.sellerBasePrice,
        currency: row.currency,
        condition: row.condition,
        partSource: row.partSource,
        qualityTier: row.qualityTier,
        sourceTag: row.sourceTag,
        sourceKey: row.sourceKey,
        sellerSku: row.sellerSku,
        sellerTitle: row.sellerTitle,
        externalOfferId: row.externalOfferId,
        leadTimeDays: row.leadTimeDays,
        quantity: warehouses.reduce(
          (sum, item) => sum + (item.quantity || 0),
          0,
        ),
        warehouses,
        buyerVisible: buyerVisible && !outranked,
        outrankedBySuperior: buyerVisible && outranked,
        updatedAt: row.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => {
      // What buyers see first, then cheapest.
      if (a.buyerVisible !== b.buyerVisible) return a.buyerVisible ? -1 : 1;
      return (a.price || Infinity) - (b.price || Infinity);
    });
}

@Injectable()
export class InternalSearchService {
  constructor(
    private readonly searchV1: SearchV1Service,
    private readonly prisma: PrismaService,
  ) {}

  async search(dto: SearchQueryDto): Promise<InternalSearchResponse> {
    const response = await this.searchV1.search(dto);
    const ids = response.results
      .map((result: any) => String(result?.id ?? ''))
      .filter(Boolean);

    const rows = ids.length
      ? ((await this.prisma.sellerOffer.findMany({
          where: { canonicalPartId: { in: ids } },
          select: OFFER_SELECT,
        })) as unknown as OfferRow[])
      : [];

    const byPart = new Map<string, OfferRow[]>();
    for (const row of rows) {
      const list = byPart.get(row.canonicalPartId) ?? [];
      list.push(row);
      byPart.set(row.canonicalPartId, list);
    }

    return {
      ...response,
      results: response.results.map((result: any) => {
        const offers = toInternalOffers(byPart.get(String(result.id)) ?? []);
        return {
          ...result,
          id: String(result.id),
          internalOffers: offers.slice(0, MAX_OFFERS_PER_RESULT),
          internalOfferCount: offers.length,
        };
      }),
      meta: { ...response.meta, audience: 'internal' },
    };
  }

  async part(id: string) {
    const part = await this.prisma.canonicalPart.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        title: true,
        normalizedTitle: true,
        description: true,
        brand: true,
        manufacturer: true,
        manufacturerPartNumber: true,
        genuineOemPartNumber: true,
        oeNumbers: true,
        category: true,
        categoryGroup: true,
        partType: true,
        partSource: true,
        qualityTier: true,
        position: true,
        vehicleSystem: true,
        fitmentStatus: true,
        fitmentConfidence: true,
        compatibility: true,
        imageUrls: true,
        listingUrl: true,
        ebayItemId: true,
        weight: true,
        dimensions: true,
        createdAt: true,
        updatedAt: true,
        offers: { select: OFFER_SELECT },
        sourceRecords: {
          select: {
            id: true,
            sellerOfferId: true,
            sourceType: true,
            sourcePlatform: true,
            externalId: true,
            sourceFileName: true,
            sourceSheet: true,
            sourceRowNumber: true,
            matchConfidence: true,
            importedAt: true,
            lastSyncedAt: true,
          },
          orderBy: { importedAt: 'desc' },
          take: 100,
        },
      },
    });
    if (!part) throw new NotFoundException('Part not found');

    const { offers, sourceRecords, ...rest } = part as any;
    const internalOffers = toInternalOffers(offers as OfferRow[]);
    return {
      ...rest,
      createdAt: part.createdAt.toISOString(),
      updatedAt: part.updatedAt.toISOString(),
      publicUrl: part.slug
        ? `https://partsbazar360.com/parts/${part.slug}`
        : `https://partsbazar360.com/part/${part.id}`,
      internalOffers,
      internalOfferCount: internalOffers.length,
      sourceRecords: (sourceRecords as any[]).map(
        (record): InternalSourceRecord => ({
          ...record,
          importedAt: record.importedAt.toISOString(),
          lastSyncedAt: record.lastSyncedAt
            ? record.lastSyncedAt.toISOString()
            : null,
        }),
      ),
    };
  }
}
