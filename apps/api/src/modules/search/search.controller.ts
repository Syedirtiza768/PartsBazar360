import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { PrismaService } from '../../prisma.service';
import { FebestWebsiteService } from './febest-website.service';

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
      return { items, total: items.length, page: 1, limit: items.length || 1 };
    }

    return this.searchService.browseParts({
      q,
      category,
      brand,
      partType,
      sort,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 200) : 24,
      includeInterchange: includeInterchange !== 'false',
    });
  }

  // Brand/category facets with counts, to power the browse-page filter sidebar.
  @Get('facets')
  async getFacets() {
    return this.searchService.getFacets();
  }

  // Direct canonical-part lookup for product detail pages, bypassing
  // fitment-first search since the buyer already knows the exact part id.
  @Get('parts/:id')
  async getPart(@Param('id') id: string) {
    const part = await this.prisma.canonicalPart.findUnique({
      where: { id },
      include: {
        offers: {
          where: { status: 'ACTIVE' },
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

    // Flatten each fitment's vehicle chain into a friendly display string
    // (e.g. "2010-2015 Audi Q7") for the product page, without exposing the
    // full relational shape to the frontend.
    const compatibleVehicles = part.fitments.map((f) => {
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
    let compatibilityTable: Array<{
      year: number | string;
      make: string;
      model: string;
      trim: string;
      engine: string;
      source?: string;
    }> = [];

    if (Array.isArray(part.compatibility) && part.compatibility.length > 0) {
      compatibilityTable = part.compatibility.map((row: any) => ({
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

    // Upgrade any remaining thumbnail URLs for display
    const sourceImages = part.media.length > 0 ? part.media.map((media) => media.url) : part.imageUrls || [];
    let imageUrls = sourceImages.map((url: string) =>
      url.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1'),
    );

    let listingUrl = part.listingUrl;
    let oemCrossReferences = part.partNumbers
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
    if (this.febestWebsite.isFebestPart(part) && part.manufacturerPartNumber) {
      const live = await this.febestWebsite.fetchLiveByMpn(part.manufacturerPartNumber);
      if (live) {
        enrichmentSource = 'febest.de';
        enrichmentLive = true;
        listingUrl = live.detailsUrl;
        if (live.imageUrls.length > 0) {
          imageUrls = live.imageUrls;
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

    return {
      ...part,
      // Strip stored compatibility from the FEBEST live path so the client
      // never treats DB cache as authoritative for these parts.
      compatibility: compatibilityTable,
      imageUrls,
      listingUrl,
      compatibleVehicles,
      compatibilityTable,
      oemCrossReferences,
      enrichmentSource,
      enrichmentLive,
      salvageUnits: (part.salvageUnits?.length
        ? part.salvageUnits
        : part.offers.flatMap((offer) => offer.salvageUnits || [])
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
