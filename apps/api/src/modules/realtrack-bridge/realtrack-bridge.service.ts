import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  RealtrackBridgeOfferQueryDto,
  RealtrackBridgeSelectionDto,
} from './realtrack-bridge.dto';
import { calculateRealtrackPrice } from './pricing.util';
import {
  RealtrackClientService,
  RemoteListingCreateResult,
} from './realtrack-client.service';

interface BridgeOfferRecord {
  id: string;
  price: number;
  sellerBasePrice: number | null;
  currency: string;
  condition: string;
  qualityTier: string;
  status: string;
  sellerSku: string | null;
  sellerTitle: string | null;
  partType: string;
  sourceTag: string | null;
  seller: { id: string; name: string };
  inventory: Array<{ quantity: number; status: string }>;
  canonicalPart: {
    id: string;
    title: string;
    brand: string | null;
    category: string | null;
    weight: number | null;
    description: string | null;
    imageUrls: string[];
    oeNumbers: string[];
    manufacturerPartNumber: string | null;
    genuineOemPartNumber: string | null;
    partType: string;
    media: Array<{ url: string; sortOrder: number; isPrimary: boolean }>;
  };
}

interface BridgePlan {
  offerId: string;
  sku: string;
  title: string;
  cost: number;
  sourceCurrency: string;
  targetCurrency: string;
  sellingPrice: number | null;
  quantity: number;
  imageUrls: string[];
  skipReason: string | null;
  skipDetail: string | null;
  offer: BridgeOfferRecord;
}

const DEFAULT_SOURCE_CURRENCY = 'USD';
const DEFAULT_TARGET_CURRENCY = 'USD';

@Injectable()
export class RealtrackBridgeService {
  private readonly logger = new Logger(RealtrackBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtrack: RealtrackClientService,
  ) {}

  async listOffers(query: RealtrackBridgeOfferQueryDto) {
    const sourceCurrency = this.currency(
      query.sourceCurrency || process.env.REALTRACK_BRIDGE_SOURCE_CURRENCY,
      DEFAULT_SOURCE_CURRENCY,
    );
    const targetCurrency = this.currency(
      query.targetCurrency || process.env.REALTRACK_BRIDGE_TARGET_CURRENCY,
      DEFAULT_TARGET_CURRENCY,
    );
    const where = this.offerWhere(query);
    const [total, offers] = await Promise.all([
      this.prisma.sellerOffer.count({ where }),
      this.findOffers(where, query.limit || 100),
    ]);

    return {
      total,
      sourceCurrency,
      targetCurrency,
      items: offers.map((offer) =>
        this.publicPlan(
          this.planOffer(
            offer,
            sourceCurrency,
            targetCurrency,
            query.includeOutOfStock === true,
          ),
        ),
      ),
    };
  }

  async preview(input: RealtrackBridgeSelectionDto) {
    const plans = await this.plansForSelection(input);
    return this.previewResponse(plans);
  }

  async transfer(input: RealtrackBridgeSelectionDto) {
    const publishToEbay = input.publishToEbay === true;
    const storeIds = [
      ...new Set((input.storeIds || []).map((id) => id.trim()).filter(Boolean)),
    ];
    if (publishToEbay && storeIds.length === 0) {
      throw new BadRequestException(
        'storeIds are required when publishToEbay is enabled',
      );
    }

    const plans = await this.plansForSelection(input);
    const dryRun = input.dryRun !== false;
    if (dryRun) return { dryRun: true, ...this.previewResponse(plans) };

    const results: Array<Record<string, unknown>> = plans
      .filter((plan) => plan.skipReason)
      .map((plan) => ({
        offerId: plan.offerId,
        status: 'skipped',
        sellingPrice: plan.sellingPrice,
        reason: plan.skipReason,
        detail: plan.skipDetail,
      }));
    const created: Array<{
      plan: BridgePlan;
      result: Record<string, unknown>;
      remote: RemoteListingCreateResult;
    }> = [];

    for (const plan of plans.filter((candidate) => !candidate.skipReason)) {
      try {
        const remote = await this.realtrack.createListing(
          this.remoteCreatePayload(plan),
        );
        const result = {
          offerId: plan.offerId,
          remoteListingId: remote.id,
          status: 'transferred',
          sellingPrice: plan.sellingPrice,
          quantity: plan.quantity,
          sku: plan.sku,
        };
        results.push(result);
        created.push({ plan, result, remote });
      } catch (error: unknown) {
        results.push({
          offerId: plan.offerId,
          status: 'transfer_failed',
          sellingPrice: plan.sellingPrice,
          error: this.errorMessage(error),
        });
      }
    }

    if (publishToEbay && created.length) {
      try {
        const response = await this.realtrack.publishBatch(
          created.map(({ plan, remote }) =>
            this.remotePublishPayload(plan, remote.id, storeIds, input),
          ),
        );
        this.applyPublishResults(created, response);
      } catch (error: unknown) {
        for (const entry of created) {
          entry.result.publishStatus = 'publish_failed';
          entry.result.publishError = this.errorMessage(error);
        }
        this.logger.error(
          `RealTrack transfer publish step failed: ${this.errorMessage(error)}`,
        );
      }
    }

    const eligibleCount = plans.filter((plan) => !plan.skipReason).length;
    return {
      dryRun: false,
      sourceCurrency: plans[0]?.sourceCurrency || this.defaultSourceCurrency(),
      targetCurrency: plans[0]?.targetCurrency || this.defaultTargetCurrency(),
      counts: {
        selected: plans.length,
        eligible: eligibleCount,
        transferred: created.length,
        skipped: plans.length - eligibleCount,
        transferFailed: eligibleCount - created.length,
        published: created.filter(
          ({ result }) => result.publishStatus === 'published',
        ).length,
      },
      results,
    };
  }

  private async plansForSelection(input: RealtrackBridgeSelectionDto) {
    const ids = [
      ...new Set(input.offerIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (!ids.length)
      throw new BadRequestException('At least one offerId is required');
    const offers = await this.findOffers({ id: { in: ids } }, ids.length);
    const found = new Set(offers.map((offer) => offer.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) {
      throw new BadRequestException(
        `Offer(s) not found: ${missing.join(', ')}`,
      );
    }

    const sourceCurrency = this.currency(
      input.sourceCurrency || process.env.REALTRACK_BRIDGE_SOURCE_CURRENCY,
      DEFAULT_SOURCE_CURRENCY,
    );
    const targetCurrency = this.currency(
      input.targetCurrency || process.env.REALTRACK_BRIDGE_TARGET_CURRENCY,
      DEFAULT_TARGET_CURRENCY,
    );
    return offers.map((offer) =>
      this.planOffer(
        offer,
        sourceCurrency,
        targetCurrency,
        input.includeOutOfStock === true,
      ),
    );
  }

  private async findOffers(
    where: Prisma.SellerOfferWhereInput,
    limit: number,
  ): Promise<BridgeOfferRecord[]> {
    return this.prisma.sellerOffer.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        price: true,
        sellerBasePrice: true,
        currency: true,
        condition: true,
        qualityTier: true,
        status: true,
        sellerSku: true,
        sellerTitle: true,
        partType: true,
        sourceTag: true,
        seller: { select: { id: true, name: true } },
        inventory: { select: { quantity: true, status: true } },
        canonicalPart: {
          select: {
            id: true,
            title: true,
            brand: true,
            category: true,
            weight: true,
            description: true,
            imageUrls: true,
            oeNumbers: true,
            manufacturerPartNumber: true,
            genuineOemPartNumber: true,
            partType: true,
            media: {
              select: { url: true, sortOrder: true, isPrimary: true },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 24,
            },
          },
        },
      },
    }) as unknown as Promise<BridgeOfferRecord[]>;
  }

  private offerWhere(
    query: RealtrackBridgeOfferQueryDto,
  ): Prisma.SellerOfferWhereInput {
    const search = query.search?.trim();
    return {
      status: query.status || 'ACTIVE',
      sourceTag: query.sourceTag || undefined,
      sellerId: query.sellerId || undefined,
      ...(search
        ? {
            OR: [
              { sellerSku: { contains: search, mode: 'insensitive' } },
              { sellerTitle: { contains: search, mode: 'insensitive' } },
              {
                canonicalPart: {
                  OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { brand: { contains: search, mode: 'insensitive' } },
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

  private planOffer(
    offer: BridgeOfferRecord,
    sourceCurrency: string,
    targetCurrency: string,
    includeOutOfStock: boolean,
  ): BridgePlan {
    const cost = offer.sellerBasePrice ?? offer.price;
    const part = offer.canonicalPart;
    const title = this.titleFor(offer);
    const quantity = offer.inventory
      .filter((row) => row.status === 'AVAILABLE')
      .reduce((sum, row) => sum + Math.max(0, row.quantity), 0);
    const imageUrls = [
      ...new Set(
        [
          ...part.imageUrls,
          ...part.media
            .sort(
              (a, b) =>
                Number(b.isPrimary) - Number(a.isPrimary) ||
                a.sortOrder - b.sortOrder,
            )
            .map((media) => media.url),
        ].filter((url) => /^https?:\/\//i.test(url)),
      ),
    ].slice(0, 24);
    const plan: BridgePlan = {
      offerId: offer.id,
      sku: this.skuFor(offer.id),
      title,
      cost,
      sourceCurrency,
      targetCurrency,
      sellingPrice: null,
      quantity,
      imageUrls,
      skipReason: null,
      skipDetail: null,
      offer,
    };

    if (offer.status !== 'ACTIVE') {
      plan.skipReason = 'inactive_offer';
      plan.skipDetail = `Offer status is ${offer.status}`;
      return plan;
    }
    if (this.currency(offer.currency, '') !== sourceCurrency) {
      plan.skipReason = 'currency_mismatch';
      plan.skipDetail = `Offer currency is ${offer.currency}; selected source currency is ${sourceCurrency}`;
      return plan;
    }
    if (!includeOutOfStock && quantity <= 0) {
      plan.skipReason = 'no_inventory';
      plan.skipDetail = 'No AVAILABLE inventory quantity';
      return plan;
    }

    const price = calculateRealtrackPrice(cost);
    plan.sellingPrice = price.sellingPrice;
    plan.skipReason = price.skipReason;
    plan.skipDetail =
      price.skipReason === 'below_minimum'
        ? 'Cost is below $5.00'
        : price.skipReason === 'invalid_cost'
          ? 'Cost is not a valid non-negative number'
          : null;
    return plan;
  }

  private publicPlan(plan: BridgePlan) {
    return {
      offerId: plan.offerId,
      sku: plan.sku,
      title: plan.title,
      seller: {
        id: plan.offer.seller.id,
        name: plan.offer.seller.name,
      },
      sellerSku: plan.offer.sellerSku,
      sourceTag: plan.offer.sourceTag,
      cost: plan.cost,
      currency: plan.offer.currency,
      targetCurrency: plan.targetCurrency,
      sellingPrice: plan.sellingPrice,
      quantity: plan.quantity,
      imageCount: plan.imageUrls.length,
      skipReason: plan.skipReason,
      skipDetail: plan.skipDetail,
    };
  }

  private previewResponse(plans: BridgePlan[]) {
    const eligible = plans.filter((plan) => !plan.skipReason).length;
    return {
      sourceCurrency: plans[0]?.sourceCurrency || this.defaultSourceCurrency(),
      targetCurrency: plans[0]?.targetCurrency || this.defaultTargetCurrency(),
      formula: [
        '$5.00-$15.00 => $38.00',
        '$16.00-$21.00 => $45.99',
        '$22.00-$25.00 => $49.99',
        'Above $25.00 => cost x 2',
        'Below $5.00 => skip',
      ],
      counts: {
        selected: plans.length,
        eligible,
        skipped: plans.length - eligible,
      },
      items: plans.map((plan) => this.publicPlan(plan)),
    };
  }

  private remoteCreatePayload(plan: BridgePlan): Record<string, unknown> {
    const part = plan.offer.canonicalPart;
    const manufacturerPartNumber =
      part.manufacturerPartNumber || plan.offer.sellerSku;
    const oeNumber = part.genuineOemPartNumber || part.oeNumbers[0] || null;
    const description =
      part.description?.trim() ||
      [
        plan.title,
        part.brand ? `Brand: ${part.brand}` : null,
        manufacturerPartNumber ? `MPN: ${manufacturerPartNumber}` : null,
        oeNumber ? `OE/OEM: ${oeNumber}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    const conditionId = this.conditionIdFor(plan.offer);
    const payload: Record<string, unknown> = {
      title: plan.title,
      customLabelSku: plan.sku,
      categoryName: part.category || undefined,
      cBrand: part.brand || undefined,
      cManufacturerPartNumber: manufacturerPartNumber || undefined,
      cOeOemPartNumber: oeNumber || undefined,
      cType: part.partType || plan.offer.partType || undefined,
      conditionId,
      startPrice: plan.sellingPrice!.toFixed(2),
      buyItNowPrice: plan.sellingPrice!.toFixed(2),
      quantity: String(plan.quantity),
      description,
      itemPhotoUrl: plan.imageUrls.join('|'),
      format: 'FIXED_PRICE',
      duration: 'GTC',
      status: 'ready',
    };
    if (part.category && /^\d+$/.test(part.category.trim())) {
      payload.categoryId = part.category.trim();
    }
    if (part.weight !== null && part.weight !== undefined) {
      payload.weight = String(part.weight);
    }
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
  }

  private remotePublishPayload(
    plan: BridgePlan,
    listingId: string,
    storeIds: string[],
    input: RealtrackBridgeSelectionDto,
  ): Record<string, unknown> {
    const categoryId = plan.offer.canonicalPart.category?.trim();
    return {
      listingId,
      storeIds,
      sku: plan.sku,
      title: plan.title,
      description: '',
      categoryId: categoryId && /^\d+$/.test(categoryId) ? categoryId : '',
      // RealTrack enriches this placeholder from the numeric conditionId
      // stored in the listing record created above.
      condition: 'NEW',
      price: plan.sellingPrice,
      currency: plan.targetCurrency,
      quantity: plan.quantity,
      imageUrls: [],
      aspects: {},
      requestedFulfillmentPolicyName: input.shippingProfileName,
      requestedReturnPolicyName: input.returnProfileName,
      requestedPaymentPolicyName: input.paymentProfileName,
    };
  }

  private applyPublishResults(
    created: Array<{
      plan: BridgePlan;
      result: Record<string, unknown>;
      remote: RemoteListingCreateResult;
    }>,
    response: unknown,
  ) {
    const record = this.asRecord(response);
    const rows = Array.isArray(response)
      ? response
      : Array.isArray(record?.results)
        ? record.results
        : Array.isArray(record?.items)
          ? record.items
          : [];
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const item = this.asRecord(row);
      const id =
        this.stringValue(item?.listingId) || this.stringValue(item?.id);
      if (id && item) byId.set(id, item);
    }
    for (const entry of created) {
      const publishResult = byId.get(entry.remote.id);
      const storeResults = publishResult?.results;
      const resultRows = Array.isArray(storeResults) ? storeResults : [];
      const failed = resultRows.filter(
        (row) => this.asRecord(row)?.success === false,
      );
      const succeeded = resultRows.filter(
        (row) => this.asRecord(row)?.success === true,
      );
      if (publishResult && succeeded.length > 0 && failed.length === 0) {
        entry.result.publishStatus = 'published';
        entry.result.publishResult = publishResult;
      } else if (publishResult) {
        entry.result.publishStatus = 'publish_failed';
        entry.result.publishError =
          failed
            .map((row) => this.stringValue(this.asRecord(row)?.error))
            .filter(Boolean)
            .join('; ') || 'RealTrack did not publish this listing';
      } else {
        entry.result.publishStatus = 'publish_failed';
        entry.result.publishError =
          'RealTrack did not return a result for this listing';
      }
    }
  }

  private titleFor(offer: BridgeOfferRecord): string {
    const part = offer.canonicalPart;
    const title =
      offer.sellerTitle?.trim() ||
      part.title?.trim() ||
      [part.brand, part.manufacturerPartNumber, part.partType]
        .filter(Boolean)
        .join(' ');
    return (title || `PartsBazar offer ${offer.id}`).slice(0, 80);
  }

  private skuFor(offerId: string): string {
    return `PB360-${offerId.replace(/-/g, '').slice(0, 32)}`;
  }

  private conditionIdFor(offer: BridgeOfferRecord): string {
    const value = (offer.condition || offer.qualityTier || 'NEW').toUpperCase();
    switch (value) {
      case 'USED':
        return '3000';
      case 'REFURBISHED':
        return '2500';
      case 'REMANUFACTURED':
        return '2000';
      case 'FOR_PARTS':
        return '7000';
      case 'NEW':
      default:
        return '1000';
    }
  }

  private currency(value: string | undefined, fallback: string): string {
    return (value || fallback).trim().toUpperCase();
  }

  private defaultSourceCurrency() {
    return this.currency(
      process.env.REALTRACK_BRIDGE_SOURCE_CURRENCY,
      DEFAULT_SOURCE_CURRENCY,
    );
  }

  private defaultTargetCurrency() {
    return this.currency(
      process.env.REALTRACK_BRIDGE_TARGET_CURRENCY,
      DEFAULT_TARGET_CURRENCY,
    );
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message.slice(0, 500);
    return 'Unexpected transfer error';
  }
}
