import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { PrismaService } from '../../prisma.service';
import { FebestWebsiteService } from './febest-website.service';
import { sanitizeSearchItems } from './buyer-visible-offers.util';
import { normalizeMvlToken, modelLookupVariants } from '../ingestion/mvl-match.util';

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

const MVL_MARKETS = ['DE', 'UK', 'AU', 'US'] as const;

@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: OpenSearchService,
    private readonly prisma: PrismaService,
    private readonly febestWebsite: FebestWebsiteService,
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
    @Query('partType') partType?: string,
    @Query('sort') sort?: 'newest' | 'price_asc' | 'price_desc',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    // Interchange search is on unless explicitly disabled (?includeInterchange=false),
    // so a superseded part number resolves by default.
    @Query('includeInterchange') includeInterchange?: string,
  ) {
    if (vehicleConfigId) {
      const items = await this.searchService.searchCompatibleParts(vehicleConfigId, q);
      const visible = sanitizeSearchItems(items);
      const enriched = await this.febestWebsite.attachImagesToSearchItems(visible);
      return { items: enriched, total: enriched.length, page: 1, limit: enriched.length || 1 };
    }

    const result = await this.searchService.browseParts({
      q,
      category,
      brand,
      partType,
      sort,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 200) : 24,
      includeInterchange: includeInterchange !== 'false',
    });
    const visible = sanitizeSearchItems(result.items || []);
    result.items = await this.febestWebsite.attachImagesToSearchItems(visible);
    return result;
  }

  // Brand/category facets with counts, to power the browse-page filter sidebar.
  @Get('facets')
  async getFacets() {
    return this.searchService.getFacets();
  }

  /** Validate a single Year/Make/Model row against the MVL catalog in the DB. */
  private async mvlVerifyRow(row: CompatRow): Promise<CompatRow> {
    const year = typeof row.year === 'number' ? row.year : parseInt(String(row.year), 10);
    if (!Number.isFinite(year) || !row.make || !row.model || row.make === '-' || row.model === '-') {
      return { ...row, mvlVerified: false };
    }
    const nMake = normalizeMvlToken(row.make);
    if (!nMake) return { ...row, mvlVerified: false };
    for (const variant of modelLookupVariants(row.model)) {
      const nModel = normalizeMvlToken(variant);
      if (!nModel) continue;
      for (const market of MVL_MARKETS) {
        const hit = await this.prisma.mvlVehicle.findFirst({
          where: { year, normalizedMake: nMake, normalizedModel: nModel, market },
          select: { make: true, model: true, trim: true, engine: true, epid: true },
        });
        if (hit) {
          return {
            ...row,
            year,
            make: hit.make || row.make,
            model: hit.model || row.model,
            trim: row.trim && row.trim !== '-' ? row.trim : hit.trim || '-',
            engine: row.engine && row.engine !== '-' ? row.engine : hit.engine || '-',
            mvlVerified: true,
            epid: hit.epid || null,
          };
        }
      }
    }
    return { ...row, mvlVerified: false };
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
            salvageUnits: { include: { donorVehicle: { include: { make: true } } } },
          },
        },
        primaryBrand: true,
        partNumbers: { include: { brand: true, vehicleMake: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        salvageUnits: { include: { donorVehicle: { include: { make: true } } } },
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
      if (offer.price === null || offer.price === undefined || Number(offer.price) <= 0) return false;
      const inv = offer.inventory || [];
      if (inv.length === 0) return true;
      return inv.some((row) => row.quantity > 0 && row.status !== 'OUT_OF_STOCK');
    });
    if (buyerOffers.length === 0) {
      throw new NotFoundException(`Part ${id} has no active offers`);
    }
    const partWithOffers = { ...part, offers: buyerOffers };

    // Flatten each fitment's vehicle chain into a friendly display string
    // (e.g. "2010-2015 Audi Q7") for the product page, without exposing the
    // full relational shape to the frontend.
    const compatibleVehicles = partWithOffers.fitments.map((f) => {
      const gen = f.vehicleConfig.generation;
      const model = gen.model;
      const make = model.make;
      const years = gen.startYear === gen.endYear ? `${gen.startYear}` : `${gen.startYear}-${gen.endYear}`;
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

    if (Array.isArray(partWithOffers.compatibility) && partWithOffers.compatibility.length > 0) {
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
    const mediaUrls = (partWithOffers.media || []).map((m) => m.url).filter(Boolean) as string[];
    const storedUrls = (partWithOffers.imageUrls || []).filter(Boolean) as string[];
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
    let oemCrossReferences = partWithOffers.partNumbers
      .filter((number) => number.numberType === 'OEM_CROSS_REFERENCE')
      .map((number) => ({
        number: number.displayNumber,
        normalizedNumber: number.normalizedNumber,
        make: number.vehicleMake?.displayName || number.vehicleMake?.name || null,
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
      const live = await this.febestWebsite.fetchLiveByMpn(partWithOffers.manufacturerPartNumber);
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
          const existing = new Set(oemCrossReferences.map((r) => r.normalizedNumber));
          for (const oem of live.oemNumbers) {
            const normalizedNumber = oem.toUpperCase().replace(/[^A-Z0-9]/g, '');
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

    // MVL validation: verify every compatibility row against the MVL vehicle
    // catalog in the DB. Only MVL-verified rows are shown to buyers so the
    // PDP compatibility table always reflects catalog-validated fitment.
    const ROW_VERIFY_CAP = 400;
    const toVerify = compatibilityTable.slice(0, ROW_VERIFY_CAP);
    const verifiedRows: CompatRow[] = [];
    for (const row of toVerify) {
      verifiedRows.push(await this.mvlVerifyRow(row));
    }
    let mvlVerifiedTable = verifiedRows.filter((r) => r.mvlVerified);

    // If nothing verifies (e.g. MVL has no data for this market yet), fall back
    // to the fitment-derived expansion so the page isn't empty — but mark
    // rows unverified so the frontend can distinguish them.
    if (mvlVerifiedTable.length === 0 && compatibilityTable.length > 0) {
      mvlVerifiedTable = compatibilityTable.map((r) => ({ ...r, mvlVerified: false }));
    }

    return {
      ...partWithOffers,
      // Strip stored compatibility from the FEBEST live path so the client
      // never treats DB cache as authoritative for these parts.
      compatibility: mvlVerifiedTable,
      imageUrls,
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
              make: unit.donorVehicle.make?.displayName || unit.donorVehicle.make?.name || null,
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
}
