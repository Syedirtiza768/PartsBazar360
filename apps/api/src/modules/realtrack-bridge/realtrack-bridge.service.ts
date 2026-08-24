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
import { RealtrackFxService } from './realtrack-fx.service';

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
    fitmentFlags: string[];
    compatibility: unknown;
    itemSpecifics: unknown;
    dimensions: unknown;
    position: string | null;
    vehicleSystem: string | null;
    listingUrl: string | null;
    ebayItemId: string | null;
    manufacturer: string | null;
    manufacturerPartNumber: string | null;
    genuineOemPartNumber: string | null;
    partType: string;
    partSource: string;
    qualityTier: string;
    fitmentStatus: string;
    fitmentConfidence: number | null;
    fitments: Array<{
      evidenceLevel: string;
      confidence: number;
      source: string | null;
      verificationStatus: string;
      reason: string | null;
      fitmentNotes: string | null;
      originalData: unknown;
      vehicleConfig: {
        trim: string | null;
        engine: string | null;
        transmission: string | null;
        drivetrain: string | null;
        fuel: string | null;
        market: string | null;
        generation: {
          name: string;
          startYear: number | null;
          endYear: number | null;
          model: {
            name: string;
            make: { name: string; displayName: string | null };
          };
        };
      };
    }>;
    media: Array<{
      url: string;
      sourceUrl: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }>;
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
  convertedCostUsd: number | null;
  conversionRateToUsd: number | null;
  quantity: number;
  imageUrls: string[];
  skipReason: string | null;
  skipDetail: string | null;
  offer: BridgeOfferRecord;
}

export type RealtrackBridgeProgressReporter = (
  progress: Record<string, unknown>,
) => Promise<void> | void;

type BridgeOfferFilters = {
  search?: string;
  brand?: string;
  sourceTag?: string;
  sellerId?: string;
  status?: string;
  sourceCurrency?: string;
};

const DEFAULT_SOURCE_CURRENCY = 'USD';
const DEFAULT_TARGET_CURRENCY = 'USD';

@Injectable()
export class RealtrackBridgeService {
  private readonly logger = new Logger(RealtrackBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtrack: RealtrackClientService,
    private readonly fx: RealtrackFxService,
  ) {}

  async listOffers(query: RealtrackBridgeOfferQueryDto) {
    const sourceCurrency = this.sourceCurrencyFilter(query.sourceCurrency);
    const targetCurrency = this.targetCurrency(query.targetCurrency);
    const where = this.offerWhere(query);
    const limit = query.limit || 100;
    const page = query.page || 1;
    const [total, offers] = await Promise.all([
      this.prisma.sellerOffer.count({ where }),
      this.findOffers(where, limit, {
        skip: (page - 1) * limit,
        maxTake: 200,
      }),
    ]);

    return {
      total,
      page,
      limit,
      hasMore: page * limit < total,
      sourceCurrency,
      targetCurrency,
      items: await Promise.all(
        offers.map(async (offer) =>
          this.publicPlan(
            await this.planOffer(
              offer,
              sourceCurrency,
              targetCurrency,
              query.includeOutOfStock === true,
            ),
          ),
        ),
      ),
    };
  }

  async preview(input: RealtrackBridgeSelectionDto) {
    const plans = await this.plansForSelection(input);
    return this.previewResponse(plans);
  }

  /**
   * Build a self-contained migration bundle without calling RealTrack.
   *
   * The bundle deliberately uses the same selection, FX, pricing, image and
   * fitment mapping code as the bridge transfer path. A destination-side
   * runner can then apply each DTO through RealTrack's ListingsService
   * transaction, avoiding the HTTP throttler while preserving business rules.
   */
  async exportMigration(input: RealtrackBridgeSelectionDto) {
    const plans = await this.plansForSelection({
      ...input,
      dryRun: true,
      targetCurrency: 'USD',
    });

    return {
      schemaVersion: 'parts-bazar-realtrack-migration/v1',
      generatedAt: new Date().toISOString(),
      filter: {
        brand: input.brand || null,
        search: input.search || null,
        status: input.status || 'ACTIVE',
        includeOutOfStock: input.includeOutOfStock === true,
        maxItems: Math.min(Math.max(input.maxItems || 5000, 1), 5000),
      },
      sourceCurrency: plans[0]?.sourceCurrency || this.defaultSourceCurrency(),
      targetCurrency: 'USD',
      pricingRule: 'realtrack-bridge-v1',
      counts: {
        selected: plans.length,
        eligible: plans.filter((plan) => !plan.skipReason).length,
        skipped: plans.filter((plan) => Boolean(plan.skipReason)).length,
      },
      records: plans.map((plan) => ({
        sourceOfferId: plan.offerId,
        sourcePartId: plan.offer.canonicalPart.id,
        sourceSellerId: plan.offer.seller.id,
        sourceBrand: plan.offer.canonicalPart.brand,
        sourceSku: plan.offer.sellerSku,
        targetSku: plan.sku,
        sourceCost: plan.cost,
        sourceCurrency: plan.offer.currency,
        convertedCostUsd: plan.convertedCostUsd,
        conversionRateToUsd: plan.conversionRateToUsd,
        sellingPriceUsd: plan.sellingPrice,
        quantity: plan.quantity,
        imageCount: plan.imageUrls.length,
        fitmentCount: plan.offer.canonicalPart.fitments.length,
        skipReason: plan.skipReason,
        skipDetail: plan.skipDetail,
        dto: plan.skipReason ? null : this.remoteCreatePayload(plan),
      })),
    };
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

    return this.executeTransfer(input, plans);
  }

  async executeTransfer(
    input: RealtrackBridgeSelectionDto,
    preloadedPlans?: BridgePlan[],
    reportProgress?: RealtrackBridgeProgressReporter,
  ) {
    const publishToEbay = input.publishToEbay === true;
    const storeIds = [
      ...new Set((input.storeIds || []).map((id) => id.trim()).filter(Boolean)),
    ];
    if (publishToEbay && storeIds.length === 0) {
      throw new BadRequestException(
        'storeIds are required when publishToEbay is enabled',
      );
    }

    const plans = preloadedPlans || (await this.plansForSelection(input));

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

    const eligiblePlans = plans.filter((candidate) => !candidate.skipReason);
    let processed = 0;
    await reportProgress?.({
      phase: 'transferring',
      total: plans.length,
      eligible: eligiblePlans.length,
      processed,
      transferred: 0,
      failed: 0,
      skipped: plans.length - eligiblePlans.length,
    });

    for (const plan of eligiblePlans) {
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
      processed += 1;
      await reportProgress?.({
        phase: 'transferring',
        total: plans.length,
        eligible: eligiblePlans.length,
        processed,
        transferred: created.length,
        failed: processed - created.length,
        skipped: plans.length - eligiblePlans.length,
      });
    }

    if (publishToEbay && created.length) {
      await reportProgress?.({
        phase: 'publishing',
        total: plans.length,
        eligible: eligiblePlans.length,
        processed,
        transferred: created.length,
        failed: processed - created.length,
        skipped: plans.length - eligiblePlans.length,
      });
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
    const response = {
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
    await reportProgress?.({
      phase: 'completed',
      total: plans.length,
      eligible: eligibleCount,
      processed,
      transferred: created.length,
      failed: eligibleCount - created.length,
      skipped: plans.length - eligibleCount,
    });
    return response;
  }

  private async plansForSelection(input: RealtrackBridgeSelectionDto) {
    const ids = [
      ...new Set((input.offerIds || []).map((id) => id.trim()).filter(Boolean)),
    ];
    let offers: BridgeOfferRecord[];
    if (input.selectAll === true) {
      const maxItems = Math.min(Math.max(input.maxItems || 5000, 1), 5000);
      if (!maxItems) {
        throw new BadRequestException('maxItems must be at least 1');
      }
      const where = this.offerWhere(input);
      offers = await this.findOffers(where, maxItems, { maxTake: 5000 });
      if (!offers.length) {
        throw new BadRequestException('No offers match the selected filters');
      }
    } else {
      if (!ids.length)
        throw new BadRequestException(
          'Select at least one offer or enable selectAll',
        );
      offers = await this.findOffers({ id: { in: ids } }, ids.length, {
        maxTake: 5000,
      });
      const found = new Set(offers.map((offer) => offer.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) {
        throw new BadRequestException(
          `Offer(s) not found: ${missing.join(', ')}`,
        );
      }
    }

    const sourceCurrency = this.sourceCurrencyFilter(input.sourceCurrency);
    const targetCurrency = this.targetCurrency(input.targetCurrency);
    return Promise.all(
      offers.map((offer) =>
        this.planOffer(
          offer,
          sourceCurrency,
          targetCurrency,
          input.includeOutOfStock === true,
        ),
      ),
    );
  }

  private async findOffers(
    where: Prisma.SellerOfferWhereInput,
    limit: number,
    options: { skip?: number; maxTake?: number } = {},
  ): Promise<BridgeOfferRecord[]> {
    return this.prisma.sellerOffer.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: Math.max(options.skip || 0, 0),
      take: Math.min(Math.max(limit, 1), options.maxTake || 200),
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
            fitmentFlags: true,
            compatibility: true,
            itemSpecifics: true,
            dimensions: true,
            position: true,
            vehicleSystem: true,
            listingUrl: true,
            ebayItemId: true,
            manufacturer: true,
            manufacturerPartNumber: true,
            genuineOemPartNumber: true,
            partType: true,
            partSource: true,
            qualityTier: true,
            fitmentStatus: true,
            fitmentConfidence: true,
            fitments: {
              select: {
                evidenceLevel: true,
                confidence: true,
                source: true,
                verificationStatus: true,
                reason: true,
                fitmentNotes: true,
                originalData: true,
                vehicleConfig: {
                  select: {
                    trim: true,
                    engine: true,
                    transmission: true,
                    drivetrain: true,
                    fuel: true,
                    market: true,
                    generation: {
                      select: {
                        name: true,
                        startYear: true,
                        endYear: true,
                        model: {
                          select: {
                            name: true,
                            make: { select: { name: true, displayName: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            media: {
              select: {
                url: true,
                sourceUrl: true,
                sortOrder: true,
                isPrimary: true,
              },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            },
          },
        },
      },
    });
  }

  private offerWhere(query: BridgeOfferFilters): Prisma.SellerOfferWhereInput {
    const search = query.search?.trim();
    const brand = query.brand?.trim();
    return {
      status: query.status || 'ACTIVE',
      sourceTag: query.sourceTag || undefined,
      sellerId: query.sellerId || undefined,
      currency: query.sourceCurrency
        ? this.currency(query.sourceCurrency, '')
        : undefined,
      canonicalPart: brand
        ? { brand: { contains: brand, mode: 'insensitive' } }
        : undefined,
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

  private async planOffer(
    offer: BridgeOfferRecord,
    sourceCurrency: string,
    targetCurrency: string,
    includeOutOfStock: boolean,
  ): Promise<BridgePlan> {
    const cost = offer.sellerBasePrice ?? offer.price;
    const part = offer.canonicalPart;
    const title = this.titleFor(offer);
    const quantity = offer.inventory
      .filter((row) => row.status === 'AVAILABLE')
      .reduce((sum, row) => sum + Math.max(0, row.quantity), 0);
    const imageUrls = this.imageUrlsFor(part);
    const plan: BridgePlan = {
      offerId: offer.id,
      sku: this.skuFor(offer.id),
      title,
      cost,
      sourceCurrency,
      targetCurrency,
      sellingPrice: null,
      convertedCostUsd: null,
      conversionRateToUsd: null,
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
    if (!includeOutOfStock && quantity <= 0) {
      plan.skipReason = 'no_inventory';
      plan.skipDetail = 'No AVAILABLE inventory quantity';
      return plan;
    }

    const initialPrice = calculateRealtrackPrice(cost);
    if (initialPrice.skipReason === 'invalid_cost') {
      plan.skipReason = initialPrice.skipReason;
      plan.skipDetail = 'Cost is not a valid non-negative number';
      return plan;
    }

    let converted: { amountUsd: number; rateToUsd: number };
    try {
      converted = await this.fx.toUsd(cost, offer.currency);
    } catch (error: unknown) {
      plan.skipReason = 'currency_conversion_unavailable';
      plan.skipDetail =
        error instanceof Error
          ? error.message
          : 'USD exchange rates are temporarily unavailable';
      return plan;
    }
    plan.convertedCostUsd = converted.amountUsd;
    plan.conversionRateToUsd = converted.rateToUsd;

    const price = calculateRealtrackPrice(converted.amountUsd);
    plan.sellingPrice = price.sellingPrice;
    plan.skipReason = price.skipReason;
    plan.skipDetail =
      price.skipReason === 'below_minimum'
        ? 'Converted USD cost is below $5.00'
        : price.skipReason === 'invalid_cost'
          ? 'Cost is not a valid non-negative number'
          : null;
    return plan;
  }

  private publicPlan(plan: BridgePlan, includeDetails = false) {
    const part = plan.offer.canonicalPart;
    const response = {
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
      convertedCostUsd: plan.convertedCostUsd,
      conversionRateToUsd: plan.conversionRateToUsd,
      targetCurrency: plan.targetCurrency,
      sellingPrice: plan.sellingPrice,
      quantity: plan.quantity,
      imageCount: plan.imageUrls.length,
      skipReason: plan.skipReason,
      skipDetail: plan.skipDetail,
      fitmentCount: part.fitments.length,
    };
    return includeDetails
      ? {
          ...response,
          compatibility: this.compatibilityFor(part),
          fitmentRows: this.fitmentRowsFor(part),
        }
      : response;
  }

  private previewResponse(plans: BridgePlan[]) {
    const eligible = plans.filter((plan) => !plan.skipReason).length;
    return {
      sourceCurrency: plans[0]?.sourceCurrency || this.defaultSourceCurrency(),
      targetCurrency: plans[0]?.targetCurrency || this.defaultTargetCurrency(),
      formula: [
        'Converted USD cost $5.00-$15.00 => $38.00',
        'Converted USD cost $16.00-$21.00 => $45.99',
        'Converted USD cost $22.00-$25.00 => $49.99',
        'Converted USD cost above $25.00 => cost x 2',
        'Converted USD cost below $5.00 => skip',
      ],
      counts: {
        selected: plans.length,
        eligible,
        skipped: plans.length - eligible,
      },
      items: plans.map((plan) => this.publicPlan(plan, true)),
    };
  }

  private remoteCreatePayload(plan: BridgePlan): Record<string, unknown> {
    const part = plan.offer.canonicalPart;
    const fitmentRows = this.fitmentRowsFor(part);
    const manufacturerPartNumber =
      part.manufacturerPartNumber || plan.offer.sellerSku;
    const oeNumber = part.genuineOemPartNumber || part.oeNumbers[0] || null;
    const itemSpecifics = this.asRecord(part.itemSpecifics);
    const itemSpecificsText = itemSpecifics
      ? Object.entries(itemSpecifics)
          .map(([name, value]) => {
            const rendered = Array.isArray(value)
              ? value.map((item) => String(item)).join(', ')
              : typeof value === 'object' && value !== null
                ? JSON.stringify(value)
                : typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                  ? String(value)
                  : '';
            return rendered ? `${name}: ${rendered}` : null;
          })
          .filter((line): line is string => Boolean(line))
          .join('\n')
      : '';
    const sourceDetails = [
      part.position ? `Position: ${part.position}` : null,
      part.vehicleSystem ? `Vehicle system: ${part.vehicleSystem}` : null,
      part.manufacturer ? `Manufacturer: ${part.manufacturer}` : null,
      part.partSource ? `Part source: ${part.partSource}` : null,
      part.qualityTier ? `Quality tier: ${part.qualityTier}` : null,
      itemSpecificsText ? `Item specifics:\n${itemSpecificsText}` : null,
      part.dimensions ? `Dimensions: ${JSON.stringify(part.dimensions)}` : null,
    ].filter((value): value is string => Boolean(value));
    const description =
      [part.description?.trim(), ...sourceDetails]
        .filter(Boolean)
        .join('\n\n') ||
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
      cFeatures: itemSpecificsText || undefined,
      itemPhotoUrl: plan.imageUrls.join('|'),
      imageUrls: plan.imageUrls,
      fitmentData: fitmentRows,
      fitmentRows,
      format: 'FIXED_PRICE',
      duration: 'GTC',
      status: 'ready',
    };
    if (part.category && /^\d+$/.test(part.category.trim())) {
      payload.categoryId = part.category.trim();
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
    const part = plan.offer.canonicalPart;
    const categoryId = part.category?.trim();
    const description = part.description?.trim() || plan.title;
    return {
      listingId,
      storeIds,
      sku: plan.sku,
      title: plan.title,
      description,
      categoryId: categoryId && /^\d+$/.test(categoryId) ? categoryId : '',
      // RealTrack enriches this placeholder from the numeric conditionId
      // stored in the listing record created above.
      condition: 'NEW',
      price: plan.sellingPrice,
      currency: plan.targetCurrency,
      quantity: plan.quantity,
      imageUrls: plan.imageUrls,
      aspects: part.itemSpecifics || {},
      compatibility: this.compatibilityFor(part),
      fitmentRows: this.fitmentRowsFor(part),
      requestedFulfillmentPolicyName: input.shippingProfileName,
      requestedReturnPolicyName: input.returnProfileName,
      requestedPaymentPolicyName: input.paymentProfileName,
    };
  }

  private compatibilityFor(part: BridgeOfferRecord['canonicalPart']) {
    const stored = part.compatibility;
    const storedRecord = this.asRecord(stored);
    if (
      Array.isArray(storedRecord?.compatibleProducts) &&
      storedRecord.compatibleProducts.length > 0
    ) {
      return { compatibleProducts: storedRecord.compatibleProducts };
    }

    const storedRows = Array.isArray(stored)
      ? stored
      : Array.isArray(storedRecord?.fitmentRows)
        ? storedRecord.fitmentRows
        : Array.isArray(storedRecord?.rows)
          ? storedRecord.rows
          : [];
    const rows = storedRows.length ? storedRows : this.fitmentRowsFor(part);
    return {
      compatibleProducts: rows
        .map((row) => this.compatibilityProductFor(row))
        .filter((row) => row.compatibilityProperties.length > 0),
    };
  }

  private compatibilityProductFor(row: unknown) {
    const record = this.asRecord(row) || {};
    const existing = Array.isArray(record.compatibilityProperties)
      ? record.compatibilityProperties
      : null;
    if (existing) return { compatibilityProperties: existing };

    const value = (...keys: string[]) => {
      for (const key of keys) {
        const candidate = record[key];
        if (candidate !== null && candidate !== undefined && candidate !== '') {
          return candidate;
        }
      }
      return null;
    };
    return {
      compatibilityProperties: [
        { name: 'Year', value: value('year', 'yearStart') },
        { name: 'Make', value: value('make') },
        { name: 'Model', value: value('model') },
        { name: 'Trim', value: value('trim') },
        { name: 'Engine', value: value('engine') },
        { name: 'Transmission', value: value('transmission') },
        { name: 'Drivetrain', value: value('drivetrain') },
        { name: 'Fuel', value: value('fuel') },
      ].filter(
        ({ value: candidate }) =>
          candidate !== null && candidate !== undefined && candidate !== '',
      ),
    };
  }

  private imageUrlsFor(part: BridgeOfferRecord['canonicalPart']) {
    return [
      ...new Set(
        [
          ...part.imageUrls,
          ...part.media
            .slice()
            .sort(
              (a, b) =>
                Number(b.isPrimary) - Number(a.isPrimary) ||
                a.sortOrder - b.sortOrder,
            )
            .flatMap((media) => [media.url, media.sourceUrl || '']),
        ]
          .map((url) => url.trim())
          .map((url) => (url.startsWith('//') ? `https:${url}` : url))
          .filter((url) => /^https?:\/\//i.test(url)),
      ),
    ];
  }

  private fitmentRowsFor(part: BridgeOfferRecord['canonicalPart']) {
    return part.fitments.map((fitment) => {
      const config = fitment.vehicleConfig;
      const generation = config.generation;
      const model = generation.model;
      const year =
        generation.startYear &&
        generation.endYear &&
        generation.startYear !== generation.endYear
          ? `${generation.startYear}-${generation.endYear}`
          : generation.startYear || generation.endYear || null;
      return {
        year,
        make: model.make.displayName || model.make.name,
        model: model.name,
        generation: generation.name,
        trim: config.trim,
        engine: config.engine,
        transmission: config.transmission,
        drivetrain: config.drivetrain,
        fuel: config.fuel,
        market: config.market,
        evidenceLevel: fitment.evidenceLevel,
        confidence: fitment.confidence,
        source: fitment.source,
        verificationStatus: fitment.verificationStatus,
        reason: fitment.reason,
        fitmentNotes: fitment.fitmentNotes,
        originalData: fitment.originalData,
      };
    });
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
    return DEFAULT_TARGET_CURRENCY;
  }

  private sourceCurrencyFilter(value?: string) {
    return value ? this.currency(value, '') : 'AUTO';
  }

  private targetCurrency(value?: string) {
    const target = this.currency(value, DEFAULT_TARGET_CURRENCY);
    if (target !== 'USD') {
      throw new BadRequestException(
        'RealTrack bridge output currency must be USD',
      );
    }
    return target;
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
