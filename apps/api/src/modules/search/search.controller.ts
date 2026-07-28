import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { OpenSearchService } from './opensearch.service';
import { PrismaService } from '../../prisma.service';
import { FebestWebsiteService } from './febest-website.service';
import { MvlOeCatalogService } from './mvl-oe-catalog.service';
import { sanitizeSearchItems } from './buyer-visible-offers.util';
import { buildPartShippingSummary } from '../checkout/part-shipping-summary.util';
import { EnrichmentService } from '../enrichment/enrichment.service';
import { renderInfographicSvg } from '../enrichment/infographic-renderer';
import {
  normalizeSpec,
  type InfographicSpec,
} from '../enrichment/infographic-spec';
import {
  locationDiagramExists,
  locationDiagramFilePath,
} from '../enrichment/location-diagram';
import {
  normalizeMvlToken,
  modelLookupVariants,
} from '../ingestion/mvl-match.util';

type CompatRow = {
  year: number | string;
  make: string;
  model: string;
  trim: string;
  engine: string;
  source?: string;
  mvlVerified?: boolean;
  epid?: string | null;
};

const MVL_MARKETS = ['US', 'DE', 'UK', 'AU'] as const;

/** Maps human-readable listing-pipeline field names → camelCase keys. */
const FIELD_TO_KEY: Record<string, string> = {
  'Brand': 'brandType',
  'MPN': 'mpn',
  'OE Number': 'oeNumber',
  'OE Numbers': 'OE_numbers',
  'Condition': 'condition',
  'Brand Type': 'brandType',
  'Warranty': 'warranty',
  'Placement': 'placementOnVehicle',
  'Position': 'position',
  'Material': 'material',
  'Color': 'color',
  'Part Type': 'partType',
  'Surface Finish': 'surfaceFinish',
  'Country of Origin': 'countryOfOrigin',
  'Category Type': 'categoryType',
  'Features': 'features',
  'Fitment Type': 'fitmentType',
  'Compatible Vehicles': 'compatibleVehicles',
  'Vehicle System': 'vehicleSystem',
};

@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: OpenSearchService,
    private readonly prisma: PrismaService,
    private readonly febestWebsite: FebestWebsiteService,
    private readonly mvlOeCatalog: MvlOeCatalogService,
    private readonly enrichment: EnrichmentService,
  ) {}

  // Fitment-first search when a vehicleConfigId is provided; otherwise falls
  // back to a general catalog browse (keyword + brand/category filters +
  // sort + pagination) so buyers can "shop all parts" without picking a
  // vehicle first — matches the browse/collection experience of Shopify etc.
  @Get('parts')
  async searchParts(
    @Query('vehicleConfigId') vehicleConfigId?: string,
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('make') make?: string,
    @Query('partType') partType?: string,
    @Query('sort') sort?: 'newest' | 'price_asc' | 'price_desc',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    // Interchange search is on unless explicitly disabled (?includeInterchange=false),
    // so a superseded part number resolves by default.
    @Query('includeInterchange') includeInterchange?: string,
  ) {
    if (vehicleConfigId) {
      const pageNum = page ? parseInt(page, 10) : 1;
      const limitNum = limit ? Math.min(parseInt(limit, 10), 200) : 24;
      const result = await this.searchService.searchCompatibleParts(
        vehicleConfigId,
        q,
        {
          page: pageNum,
          limit: limitNum,
        },
      );
      const visible = sanitizeSearchItems(result.items);
      const enriched =
        await this.febestWebsite.attachImagesToSearchItems(visible);
      // Speculative: warm the parts a buyer is about to open, at low priority
      // so a real PDP view still jumps the queue. Never awaited.
      void this.enrichment.requestEnrichmentByIds(
        enriched.map((item: { id?: string }) => item.id || ''),
        { reason: 'search_results', priority: 20, limit: 8 },
      );
      return {
        items: enriched,
        total: result.total,
        page: result.page,
        limit: result.limit,
      };
    }

    const result = await this.searchService.browseParts({
      q,
      category,
      brand,
      make,
      partType,
      sort,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 200) : 24,
      includeInterchange: includeInterchange !== 'false',
    });
    const visible = sanitizeSearchItems(result.items || []);
    result.items = await this.febestWebsite.attachImagesToSearchItems(visible);
    void this.enrichment.requestEnrichmentByIds(
      (result.items || []).map((item: { id?: string }) => item.id || ''),
      { reason: 'search_results', priority: 20, limit: 8 },
    );
    return result;
  }

  // Brand/category facets with counts, to power the browse-page filter sidebar.
  @Get('facets')
  async getFacets() {
    return this.searchService.getFacets();
  }

  // Lightweight autocomplete — returns top parts, categories, and brands
  // for a partial query. Called on every keystroke (debounced client-side).
  @Get('suggest')
  async suggest(@Query('q') q?: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) return { parts: [], categories: [], brands: [] };
    return this.searchService.suggest(query);
  }

  /**
   * Validate Year/Make/Model rows against MVL in one (or few) batched queries
   * instead of findFirst-per-row-per-market. Preserves market preference order
   * US → DE → UK → AU and modelLookupVariants priority.
   * Buyer catalog is US marketplace; prefer US ePID rows when verifying.
   */
  private async mvlVerifyRows(rows: CompatRow[]): Promise<CompatRow[]> {
    type LookupKey = { year: number; nMake: string; nModel: string };
    const lookups: LookupKey[] = [];
    const seen = new Set<string>();

    const parsed = rows.map((row) => {
      const year =
        typeof row.year === 'number'
          ? row.year
          : parseInt(String(row.year), 10);
      if (
        !Number.isFinite(year) ||
        !row.make ||
        !row.model ||
        row.make === '-' ||
        row.model === '-'
      ) {
        return { row, year: NaN, nMake: '', variants: [] as string[] };
      }
      const nMake = normalizeMvlToken(row.make);
      if (!nMake)
        return { row, year: NaN, nMake: '', variants: [] as string[] };
      const variants = modelLookupVariants(row.model)
        .map((v) => normalizeMvlToken(v))
        .filter(Boolean);
      for (const nModel of variants) {
        const key = `${year}|${nMake}|${nModel}`;
        if (!seen.has(key)) {
          seen.add(key);
          lookups.push({ year, nMake, nModel });
        }
      }
      return { row, year, nMake, variants };
    });

    type Hit = {
      year: number;
      normalizedMake: string;
      normalizedModel: string;
      market: string;
      make: string | null;
      model: string | null;
      trim: string | null;
      engine: string | null;
      epid: string | null;
    };
    const hits: Hit[] = [];
    const CHUNK = 80;
    for (let i = 0; i < lookups.length; i += CHUNK) {
      const chunk = lookups.slice(i, i + CHUNK);
      const batch = await this.prisma.mvlVehicle.findMany({
        where: {
          OR: chunk.map((k) => ({
            year: k.year,
            normalizedMake: k.nMake,
            normalizedModel: k.nModel,
            market: { in: [...MVL_MARKETS] },
          })),
        },
        select: {
          year: true,
          normalizedMake: true,
          normalizedModel: true,
          market: true,
          make: true,
          model: true,
          trim: true,
          engine: true,
          epid: true,
        },
      });
      hits.push(...batch);
    }

    const marketRank = new Map<string, number>(
      MVL_MARKETS.map((m, i) => [m, i]),
    );
    // Best hit per year|make|model by market preference
    const bestByKey = new Map<string, Hit>();
    for (const hit of hits) {
      const key = `${hit.year}|${hit.normalizedMake}|${hit.normalizedModel}`;
      const existing = bestByKey.get(key);
      if (!existing) {
        bestByKey.set(key, hit);
        continue;
      }
      const prev = marketRank.get(existing.market) ?? 99;
      const next = marketRank.get(hit.market) ?? 99;
      if (next < prev) bestByKey.set(key, hit);
    }

    return parsed.map(({ row, year, nMake, variants }) => {
      if (!Number.isFinite(year) || !nMake || variants.length === 0) {
        return { ...row, mvlVerified: false };
      }
      for (const nModel of variants) {
        const hit = bestByKey.get(`${year}|${nMake}|${nModel}`);
        if (hit) {
          return {
            ...row,
            year,
            make: hit.make || row.make,
            model: hit.model || row.model,
            trim: row.trim && row.trim !== '-' ? row.trim : hit.trim || '-',
            engine:
              row.engine && row.engine !== '-' ? row.engine : hit.engine || '-',
            mvlVerified: true,
            epid: hit.epid || null,
          };
        }
      }
      return { ...row, mvlVerified: false };
    });
  }

  // Direct canonical-part lookup for product detail pages, bypassing
  // fitment-first search since the buyer already knows the exact part id.
  @Get('parts/:id')
  async getPart(@Param('id') id: string) {
    const part = await this.prisma.canonicalPart.findUnique({
      where: { id },
      include: {
        offers: {
          where: {
            status: 'ACTIVE',
            seller: { onboardingStatus: 'ACTIVE' },
          },
          // Seller profile carries the buyer-facing policy data (returns
          // window, warranty, fulfilment SLA, country) shown on the PDP.
          include: {
            seller: { include: { profile: true } },
            inventory: { include: { warehouse: true } },
            prices: true,
            salvageUnits: {
              include: { donorVehicle: { include: { make: true } } },
            },
          },
        },
        primaryBrand: true,
        partNumbers: { include: { brand: true, vehicleMake: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        salvageUnits: {
          include: { donorVehicle: { include: { make: true } } },
        },
        fitments: {
          include: {
            vehicleConfig: {
              include: {
                generation: {
                  include: { model: { include: { make: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!part) {
      throw new NotFoundException(`Part ${id} not found`);
    }

    // RealTrack salvage sometimes has empty inventory while still ACTIVE —
    // keep those. Spreadsheet offers carry inventory: hide zero-stock rows.
    // Also drop offers with no usable price so no tile/PDP renders price-less.
    const buyerOffers = part.offers.filter((offer) => {
      if (
        offer.price === null ||
        offer.price === undefined ||
        Number(offer.price) <= 0
      )
        return false;
      const inv = offer.inventory || [];
      if (inv.length === 0) return true;
      return inv.some(
        (row) => row.quantity > 0 && row.status !== 'OUT_OF_STOCK',
      );
    });
    if (buyerOffers.length === 0) {
      throw new NotFoundException(`Part ${id} has no active offers`);
    }
    const partWithOffers = { ...part, offers: buyerOffers };

    // Flatten each fitment's vehicle chain into a friendly display string
    // (e.g. "2010-2015 Audi Q7") for the product page, without exposing the
    // full relational shape to the frontend.
    let compatibleVehicles = partWithOffers.fitments.map((f) => {
      const gen = f.vehicleConfig.generation;
      const model = gen.model;
      const make = model.make;
      const years =
        gen.startYear === gen.endYear
          ? `${gen.startYear}`
          : `${gen.startYear}-${gen.endYear}`;
      return {
        label: `${years} ${make.name} ${model.name}`,
        make: make.name,
        model: model.name,
        startYear: gen.startYear,
        endYear: gen.endYear,
        evidenceLevel: f.evidenceLevel,
        confidence: f.confidence,
      };
    });

    // eBay-style per-year compatibility rows for the product page table.
    // Prefer stored compatibility JSON; fall back to expanding fitment year ranges.
    // FEBEST parts override this with a live febest.de lookup (not persisted).
    let compatibilityTable: CompatRow[] = [];

    if (
      Array.isArray(partWithOffers.compatibility) &&
      partWithOffers.compatibility.length > 0
    ) {
      compatibilityTable = partWithOffers.compatibility.map((row: any) => ({
        year: row.year ?? '-',
        make: row.make ?? '-',
        model: row.model ?? '-',
        trim: row.trim ?? '-',
        engine: row.engine ?? '-',
        source: row.source,
      }));
    } else {
      for (const v of compatibleVehicles) {
        if (!v.startYear || !v.endYear) continue;
        const from = Math.min(v.startYear, v.endYear);
        const to = Math.max(v.startYear, v.endYear);
        for (let year = from; year <= Math.min(to, from + 40); year++) {
          compatibilityTable.push({
            year,
            make: v.make,
            model: v.model,
            trim: '-',
            engine: '-',
            source: 'title',
          });
        }
      }
    }

    // Consolidate every available image: ProductMedia rows + stored imageUrls.
    // Dedupe by URL and upgrade eBay thumbnails to s-l1600 for display.
    const mediaUrls = (partWithOffers.media || [])
      .map((m) => m.url)
      .filter(Boolean);
    const storedUrls = (partWithOffers.imageUrls || []).filter(Boolean);
    const seenUrl = new Set<string>();
    const dedupePush = (list: string[]) => {
      for (const u of list) {
        if (u && !seenUrl.has(u)) {
          seenUrl.add(u);
          imageUrls.push(u);
        }
      }
    };
    let imageUrls: string[] = [];
    dedupePush(mediaUrls);
    dedupePush(storedUrls);
    imageUrls = imageUrls.map((url) =>
      url.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1'),
    );

    let listingUrl = partWithOffers.listingUrl;
    const oemCrossReferences = partWithOffers.partNumbers
      .filter((number) => number.numberType === 'OEM_CROSS_REFERENCE')
      .map((number) => ({
        number: number.displayNumber,
        normalizedNumber: number.normalizedNumber,
        make:
          number.vehicleMake?.displayName || number.vehicleMake?.name || null,
        verificationStatus: number.verificationStatus,
      }));
    let enrichmentSource: string | null = null;
    let enrichmentLive = false;

    // FEBEST: resolve images + compatibility live from febest.de for this PDP
    // load only. Hotlink static.febest.de URLs; do not write to Postgres.
    if (
      this.febestWebsite.isFebestPart({
        brand: partWithOffers.brand,
        primaryBrand: partWithOffers.primaryBrand
          ? {
              displayName: partWithOffers.primaryBrand.displayName,
              canonicalName: partWithOffers.primaryBrand.canonicalName,
            }
          : null,
        manufacturerPartNumber: partWithOffers.manufacturerPartNumber,
        offers: partWithOffers.offers.map((o) => ({
          sellerId: o.sellerId,
          seller: o.seller ? { name: o.seller.name } : null,
        })),
      }) &&
      partWithOffers.manufacturerPartNumber
    ) {
      const live = await this.febestWebsite.fetchLiveByMpn(
        partWithOffers.manufacturerPartNumber,
      );
      if (live) {
        enrichmentSource = 'febest.de';
        enrichmentLive = true;
        listingUrl = live.detailsUrl;
        if (live.imageUrls.length > 0) {
          // Merge live FEBEST images with stored ones; live take priority.
          const merged: string[] = [];
          const seen = new Set<string>();
          for (const u of [...live.imageUrls, ...imageUrls]) {
            if (u && !seen.has(u)) {
              seen.add(u);
              merged.push(u);
            }
          }
          imageUrls = merged;
        }
        if (live.compatibility.length > 0) {
          compatibilityTable = live.compatibility.map((row) => ({
            year: row.year,
            make: row.make,
            model: row.model,
            trim: row.trim,
            engine: row.engine,
            source: row.source,
          }));
        }
        if (live.oemNumbers.length > 0) {
          const existing = new Set(
            oemCrossReferences.map((r) => r.normalizedNumber),
          );
          for (const oem of live.oemNumbers) {
            const normalizedNumber = oem
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '');
            if (!normalizedNumber || existing.has(normalizedNumber)) continue;
            existing.add(normalizedNumber);
            oemCrossReferences.push({
              number: oem,
              normalizedNumber,
              make: null,
              verificationStatus: 'CATALOG_DECLARED',
            });
          }
        }
      }
    }

    // OE-catalog enrichment from MVL: when an OE part only has sparse
    // donor/title fitment (e.g. a single salvage year), expand to the full
    // chassis generation in MVL (trims/engines/years) — same shape as OEM
    // dealer catalog tables. Skipped when FEBEST already supplied live rows.
    if (!enrichmentLive) {
      const salvageSeeds = (
        partWithOffers.salvageUnits?.length
          ? partWithOffers.salvageUnits
          : partWithOffers.offers.flatMap((o) => o.salvageUnits || [])
      )
        .map((unit) => unit.donorVehicle)
        .filter(Boolean)
        .map((donor) => ({
          year: donor!.modelYear,
          make: donor!.make?.displayName || donor!.make?.name || null,
          model: donor!.model,
          trim: donor!.trim,
          engine: donor!.engine,
        }));

      const oeEnrichment = await this.mvlOeCatalog.enrichForPart({
        oeNumbers: partWithOffers.oeNumbers,
        genuineOemPartNumber: partWithOffers.genuineOemPartNumber,
        manufacturerPartNumber: partWithOffers.manufacturerPartNumber,
        partSource: partWithOffers.partSource,
        seeds: [
          ...compatibilityTable,
          ...compatibleVehicles.map((v) => ({
            year: v.startYear,
            make: v.make,
            model: v.model,
          })),
          ...salvageSeeds,
        ],
        existingRows: compatibilityTable,
      });

      if (oeEnrichment?.expanded) {
        enrichmentSource = oeEnrichment.platform
          ? `mvl_catalog:${oeEnrichment.platform}`
          : 'mvl_catalog';
        enrichmentLive = true;
        compatibilityTable = oeEnrichment.rows.map((row) => ({
          year: row.year,
          make: row.make,
          model: row.model,
          trim: row.trim,
          engine: row.engine,
          source: row.source,
          mvlVerified: true,
          epid: row.epid ?? null,
        }));
        compatibleVehicles = oeEnrichment.compatibleVehicles;
      }
    }

    // MVL validation: verify compatibility rows against the MVL vehicle
    // catalog in batched queries. Only MVL-verified rows are shown to buyers
    // so the PDP compatibility table always reflects catalog-validated fitment.
    // Rows already stamped mvlVerified from OE-catalog expansion skip re-check.
    const ROW_VERIFY_CAP = 400;
    const alreadyVerified = compatibilityTable.filter(
      (r) => r.mvlVerified === true,
    );
    const needsVerify = compatibilityTable
      .filter((r) => r.mvlVerified !== true)
      .slice(0, ROW_VERIFY_CAP);
    const verifiedRows = await this.mvlVerifyRows(needsVerify);
    let mvlVerifiedTable = [
      ...alreadyVerified,
      ...verifiedRows.filter((r) => r.mvlVerified),
    ].sort((a, b) => {
      const ay =
        typeof a.year === 'number' ? a.year : parseInt(String(a.year), 10);
      const by =
        typeof b.year === 'number' ? b.year : parseInt(String(b.year), 10);
      if (ay !== by) return (ay || 0) - (by || 0);
      return String(a.trim || '').localeCompare(String(b.trim || ''));
    });

    // If nothing verifies (e.g. MVL has no data for this market yet), fall back
    // to the fitment-derived expansion so the page isn't empty — but mark
    // rows unverified so the frontend can distinguish them.
    if (mvlVerifiedTable.length === 0 && compatibilityTable.length > 0) {
      mvlVerifiedTable = compatibilityTable.map((r) => ({
        ...r,
        mvlVerified: false,
      }));
    }

    // Normalize itemSpecifics: the listing-pipeline stores an array of
    // { field, value } objects, but the enrich-itemspecifics script and the
    // frontend both expect a flat object keyed by camelCase property name.
    // Merge both representations so the PDP always renders correctly.
    const rawIs = (part as any).itemSpecifics;
    let normalizedItemSpecifics: Record<string, unknown> | null = null;
    let normalizedPosition = (part as any).position ?? null;
    let normalizedVehicleSystem = (part as any).vehicleSystem ?? null;
    let normalizedMaterial = (part as any).material ?? null;

    if (Array.isArray(rawIs)) {
      // Listing-pipeline array format: [{ field, value, ... }]
      const map: Record<string, unknown> = {};
      for (const entry of rawIs) {
        if (entry && typeof entry.field === 'string' && entry.value != null) {
          // Map human-readable field names to camelCase keys the frontend expects
          const key =
            FIELD_TO_KEY[entry.field] ||
            entry.field.charAt(0).toLowerCase() + entry.field.slice(1);
          map[key] = entry.value;
        }
      }
      normalizedItemSpecifics = Object.keys(map).length > 0 ? map : null;
    } else if (rawIs && typeof rawIs === 'object') {
      // Already flat object format (enrich-itemspecifics script)
      normalizedItemSpecifics = rawIs as Record<string, unknown>;
    }

    // Backfill standalone columns from normalized itemSpecifics
    if (!normalizedPosition && normalizedItemSpecifics?.position) {
      normalizedPosition = String(normalizedItemSpecifics.position);
    }
    if (!normalizedVehicleSystem && normalizedItemSpecifics?.vehicleSystem) {
      normalizedVehicleSystem = String(normalizedItemSpecifics.vehicleSystem);
    }
    if (!normalizedMaterial && normalizedItemSpecifics?.material) {
      normalizedMaterial = String(normalizedItemSpecifics.material);
    }

    // Cache-aside: this view is what triggers enrichment, but the response never
    // waits on it. Not awaited, and the service swallows its own failures.
    void this.enrichment.requestEnrichment(part, { reason: 'pdp_view' });

    // The location diagram and SVG infographic lead the gallery. sortOrder
    // already puts them first in the common case, but the FEBEST live path
    // prepends its own scrape, so hoist explicitly rather than relying on merge.
    const locationDiagram = (partWithOffers.media || []).find(
      (m) => m.mediaType === 'LOCATION_DIAGRAM',
    );
    const infographic = (partWithOffers.media || []).find(
      (m) => m.mediaType === 'INFOGRAPHIC',
    );
    for (const lead of [infographic, locationDiagram]) {
      if (lead?.url) {
        imageUrls = [
          lead.url,
          ...imageUrls.filter((url) => url !== lead.url),
        ];
      }
    }

    return {
      ...partWithOffers,
      itemSpecifics: normalizedItemSpecifics,
      position: normalizedPosition,
      vehicleSystem: normalizedVehicleSystem,
      material: normalizedMaterial,
      // Always resolvable, so the PDP can render a shipping figure on first
      // paint instead of waiting on background enrichment.
      shipping: buildPartShippingSummary(part),
      // Strip stored compatibility from the FEBEST live path so the client
      // never treats DB cache as authoritative for these parts.
      compatibility: mvlVerifiedTable,
      imageUrls,
      locationDiagramUrl: locationDiagram?.url ?? null,
      locationDiagramAlt: locationDiagram?.altText ?? null,
      infographicUrl: infographic?.url ?? null,
      infographicAlt: infographic?.altText ?? null,
      listingUrl,
      compatibleVehicles,
      compatibilityTable: mvlVerifiedTable,
      oemCrossReferences,
      enrichmentSource,
      enrichmentLive,
      salvageUnits: (partWithOffers.salvageUnits?.length
        ? partWithOffers.salvageUnits
        : partWithOffers.offers.flatMap((offer) => offer.salvageUnits || [])
      ).map((unit) => ({
        id: unit.id,
        originalOemNumber: unit.originalOemNumber,
        conditionGrade: unit.conditionGrade,
        testedStatus: unit.testedStatus,
        damageNotes: unit.damageNotes,
        missingComponents: unit.missingComponents,
        warranty: unit.warranty,
        dismantlingLocation: unit.dismantlingLocation,
        shelfBin: unit.shelfBin,
        identityMethod: unit.identityMethod,
        donorVehicle: unit.donorVehicle
          ? {
              make:
                unit.donorVehicle.make?.displayName ||
                unit.donorVehicle.make?.name ||
                null,
              model: unit.donorVehicle.model,
              modelYear: unit.donorVehicle.modelYear,
              trim: unit.donorVehicle.trim,
              engine: unit.donorVehicle.engine,
              vinMasked: unit.donorVehicle.vinMasked,
              mileage: unit.donorVehicle.mileage,
              mileageUnit: unit.donorVehicle.mileageUnit,
              donorStockNumber: unit.donorVehicle.donorStockNumber,
            }
          : null,
      })),
    };
  }

  /**
   * Minimal projection used by the PDP to reconcile a part after background
   * enrichment finishes. Deliberately excludes offers, fitment and the FEBEST
   * live scrape so it stays cheap enough to poll every couple of seconds.
   */
  @Get('parts/:id/enrichment')
  async getPartEnrichment(@Param('id') id: string) {
    const part = await this.prisma.canonicalPart.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        category: true,
        weight: true,
        weightSource: true,
        weightConfidence: true,
        partClassKey: true,
        dimensions: true,
        itemSpecifics: true,
        enrichmentStatus: true,
        enrichmentVersion: true,
        enrichedAt: true,
        media: {
          where: {
            mediaType: { in: ['LOCATION_DIAGRAM', 'INFOGRAPHIC'] },
          },
          orderBy: { sortOrder: 'asc' },
          take: 4,
          select: { url: true, altText: true, mediaType: true },
        },
      },
    });

    if (!part) {
      throw new NotFoundException(`Part ${id} not found`);
    }

    const locationDiagram = part.media.find(
      (m) => m.mediaType === 'LOCATION_DIAGRAM',
    );
    const infographic = part.media.find((m) => m.mediaType === 'INFOGRAPHIC');

    return {
      id: part.id,
      shipping: buildPartShippingSummary(part),
      enrichmentStatus: part.enrichmentStatus,
      enrichmentVersion: part.enrichmentVersion,
      enrichedAt: part.enrichedAt,
      hasItemSpecifics: Boolean(part.itemSpecifics),
      itemSpecifics: part.itemSpecifics,
      locationDiagramUrl: locationDiagram?.url ?? null,
      locationDiagramAlt: locationDiagram?.altText ?? null,
      infographicUrl: infographic?.url ?? null,
      infographicAlt: infographic?.altText ?? null,
    };
  }

  /**
   * Intent-based pre-warm: the buyer marketplace fires this when a product card
   * enters the viewport or is hovered, so enrichment is already running by the
   * time the PDP opens. Always returns immediately; the work is fire-and-forget.
   */
  @Post('enrichment/prewarm')
  async prewarmEnrichment(@Body() body: { partIds?: string[] }) {
    const partIds = Array.isArray(body?.partIds)
      ? body.partIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    // Cap hard: a scraped results page must not enqueue the whole catalogue.
    const capped = [...new Set(partIds)].slice(0, 12);
    if (!capped.length) return { accepted: 0 };

    void this.enrichment.requestEnrichmentByIds(capped, {
      reason: 'intent',
      priority: 15,
      limit: 8,
    });

    return { accepted: capped.length };
  }

  /**
   * Renders the stored infographic spec to SVG on demand.
   *
   * Nothing is rasterised or stored: templating a card is pure string work, far
   * cheaper than the object-storage round trip it would replace, and it means a
   * redesign ships with a deploy instead of a batch re-render. Express adds an
   * ETag, so repeat views settle at a 304.
   */
  @Get('parts/:id/infographic.svg')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header(
    'Cache-Control',
    'public, max-age=600, stale-while-revalidate=604800',
  )
  async getPartInfographic(@Param('id') id: string) {
    const part = await this.prisma.canonicalPart.findUnique({
      where: { id },
      select: {
        brand: true,
        manufacturerPartNumber: true,
        infographicSpec: true,
      },
    });

    // Re-normalised on read so a spec written by an older, looser generation
    // can never emit a malformed document.
    const spec: InfographicSpec | null = part
      ? normalizeSpec(part.infographicSpec)
      : null;
    if (!spec) {
      throw new NotFoundException(`No infographic for part ${id}`);
    }

    return renderInfographicSvg(spec, {
      brand: part!.brand,
      footnote: part!.manufacturerPartNumber
        ? `Part number ${part!.manufacturerPartNumber} · Specifications supplied by the seller`
        : 'Specifications supplied by the seller',
    });
  }

  /**
   * Serves the AI-generated location / OEM-callout diagram PNG written by the
   * enrichment worker to the shared media volume.
   */
  @Get('parts/:id/location-diagram.png')
  @Header('Content-Type', 'image/png')
  @Header(
    'Cache-Control',
    'public, max-age=600, stale-while-revalidate=604800',
  )
  async getPartLocationDiagram(@Param('id') id: string) {
    if (!(await locationDiagramExists(id))) {
      throw new NotFoundException(`No location diagram for part ${id}`);
    }
    const stream = createReadStream(locationDiagramFilePath(id));
    return new StreamableFile(stream);
  }
}
