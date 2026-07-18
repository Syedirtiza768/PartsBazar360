import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import {
  extractCategory,
  extractOeNumbers,
  parseVehicleFromTitle,
} from '../ingestion/listing-parser.util';
import type { ParsedVehicle } from '../ingestion/listing-parser.util';
import { PricingService } from '../pricing/pricing.service';
import { createHash } from 'node:crypto';
import { SpreadsheetParserService } from '../catalog-import/spreadsheet-parser.service';
import { classifyPart } from '../catalog-import/classification.util';
import { parseCompoundOemReferences } from '../catalog-import/oem-reference.parser';
import { deterministicSourceKey, normalizeMasterName, normalizePartNumber } from '../catalog-import/part-normalization.util';

interface ParsedUploadRow {
  rowNumber: number;
  sheetName?: string;
  raw: Record<string, string>;
  original?: Record<string, string>;
}

const HEADER_MAP: Record<string, string> = {
  '*title': 'title',
  title: 'title',
  name: 'title',
  '*customlabel': 'sku',
  customlabel: 'sku',
  customlabelsku: 'sku',
  sku: 'sku',
  '*startprice': 'price',
  startprice: 'price',
  price: 'price',
  '*quantity': 'quantity',
  quantity: 'quantity',
  qty: 'quantity',
  picurl: 'imageUrls',
  imageurl: 'imageUrls',
  imageurls: 'imageUrls',
  images: 'imageUrls',
  '*conditionid': 'condition',
  conditionid: 'condition',
  condition: 'condition',
  brand: 'brand',
  'c:brand': 'brand',
  '*c:brand': 'brand',
  'manufacturer part number': 'mpn',
  mpn: 'mpn',
  'c:manufacturer part number': 'mpn',
  'oem part number': 'oemPartNumber',
  'oe/oem part number': 'oemPartNumber',
  'c:oe/oem part number': 'oemPartNumber',
  category: 'category',
  categoryname: 'category',
  'part type': 'partType',
  'c:type': 'partType',
  currency: 'currency',
};

const CONDITION_LABELS: Record<string, string> = {
  '1000': 'NEW',
  '1500': 'NEW_OTHER',
  '2000': 'REFURBISHED',
  '2500': 'REFURBISHED',
  '3000': 'USED',
  '4000': 'USED',
  '5000': 'USED',
  '6000': 'USED',
  '7000': 'FOR_PARTS',
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/\*/g, '').trim();
}

function normalizePartSource(value?: string | null) {
  const raw = (value || '').toUpperCase();
  if (raw.includes('AFTER')) return 'AFTERMARKET';
  return 'OEM';
}

function normalizeQualityTier(value?: string | null) {
  const raw = (value || '').toUpperCase();
  if (CONDITION_LABELS[raw]) return CONDITION_LABELS[raw];
  if (raw.includes('FOR PART') || raw.includes('NOT WORKING')) return 'FOR_PARTS';
  if (raw.includes('REMAN')) return 'REMANUFACTURED';
  if (raw.includes('REFURB')) return 'REFURBISHED';
  if (raw.includes('NEW')) return 'NEW';
  return 'USED';
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out;
}

function parseDelimitedFile(buffer: Buffer): ParsedUploadRow[] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const raw: Record<string, string> = {};
    headers.forEach((header, i) => {
      const mapped = HEADER_MAP[normalizeHeader(header)] || HEADER_MAP[header.toLowerCase().trim()];
      if (mapped && cells[i]) raw[mapped] = cells[i];
    });
    return { rowNumber: index + 2, raw };
  });
}

@Injectable()
export class MerchantUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: OpenSearchService,
    private readonly pricing: PricingService,
    private readonly spreadsheetParser: SpreadsheetParserService,
  ) {}

  async listJobs(sellerId: string) {
    if (!sellerId) throw new BadRequestException('sellerId query parameter is required');
    return this.prisma.sellerUploadJob.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: { rows: { take: 5, orderBy: { rowNumber: 'asc' } } },
    });
  }

  async getJob(jobId: string) {
    const job = await this.prisma.sellerUploadJob.findUnique({
      where: { id: jobId },
      include: {
        seller: true,
        rows: {
          orderBy: { rowNumber: 'asc' },
          include: { canonicalPart: true, sellerOffer: true },
        },
      },
    });
    if (!job) throw new NotFoundException('Upload job not found');
    return job;
  }

  async processUpload(
    sellerId: string,
    fileName: string,
    buffer: Buffer,
    opts: {
      defaultPartSource?: string;
      defaultQualityTier?: string;
      defaultBrand?: string;
      defaultCurrency?: string;
      defaultWeightUnit?: string;
      defaultDimensionUnit?: string;
    },
  ) {
    if (!sellerId) throw new BadRequestException('sellerId is required');
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: { warehouses: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');

    const parsedSheets = await this.spreadsheetParser.parse(fileName, buffer);
    const parsedRows: ParsedUploadRow[] = parsedSheets.flatMap((sheet) => sheet.rows.map((row) => ({
      ...row,
      raw: {
        ...row.raw,
        __template: sheet.template,
        __suggestedBrand: sheet.suggestedDefaults.brand || '',
        __suggestedPartType: sheet.suggestedDefaults.partType || '',
      },
    })));
    if (parsedRows.length === 0) {
      throw new BadRequestException('Upload file must contain a header row and at least one data row');
    }

    const defaultPartSource = normalizePartSource(opts.defaultPartSource);
    const defaultQualityTier = normalizeQualityTier(opts.defaultQualityTier);
    const fileChecksum = createHash('sha256').update(buffer).digest('hex');
    const existingJob = await this.prisma.sellerUploadJob.findFirst({
      where: { sellerId, fileChecksum },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (existingJob?.status === 'COMPLETED' || existingJob?.status === 'NEEDS_REVIEW') return existingJob;

    const job = await this.prisma.sellerUploadJob.create({
      data: {
        sellerId,
        fileName,
        status: 'PROCESSING',
        totalRows: parsedRows.length,
        defaultPartSource,
        defaultQualityTier,
        fileChecksum,
        mimeType: fileName.toLowerCase().endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
        sourceSheet: parsedSheets.length === 1 ? parsedSheets[0].sheetName : null,
        defaultBrand: opts.defaultBrand || parsedSheets[0]?.suggestedDefaults.brand || null,
        defaultCurrency: opts.defaultCurrency || null,
        defaultWeightUnit: opts.defaultWeightUnit || null,
        defaultDimensionUnit: opts.defaultDimensionUnit || null,
        mapping: parsedSheets.map((sheet) => ({ sheet: sheet.sheetName, template: sheet.template, headers: sheet.headers })),
      },
    });

    const warehouse = seller.warehouses[0] ?? await this.prisma.warehouse.create({
      data: { sellerId, name: `${seller.name} Default Warehouse`, location: 'Marketplace intake' },
    });

    let insertedRows = 0;
    let reviewRows = 0;
    let invalidRows = 0;
    const warnings: string[] = [];

    for (const row of parsedRows) {
      const result = await this.processRow(job.id, sellerId, seller.name, seller.onboardingStatus, warehouse.id, row, {
        defaultPartSource,
        defaultQualityTier,
        defaultBrand: opts.defaultBrand || parsedSheets[0]?.suggestedDefaults.brand,
        defaultCurrency: opts.defaultCurrency,
        defaultWeightUnit: opts.defaultWeightUnit,
        defaultDimensionUnit: opts.defaultDimensionUnit,
        fileName,
        fileChecksum,
      });
      if (result.status === 'INVALID') invalidRows++;
      else if (result.status === 'NEEDS_REVIEW') reviewRows++;
      else insertedRows++;
      if (result.message) warnings.push(`Row ${row.rowNumber}: ${result.message}`);
    }

    return this.prisma.sellerUploadJob.update({
      where: { id: job.id },
      data: {
        status: invalidRows === parsedRows.length ? 'FAILED' : reviewRows > 0 ? 'NEEDS_REVIEW' : 'COMPLETED',
        processedRows: parsedRows.length,
        insertedRows,
        reviewRows,
        invalidRows,
        warnings,
        report: {
          filesProcessed: 1,
          sheetsProcessed: parsedSheets.length,
          rowsRead: parsedRows.length,
          rowsImported: insertedRows,
          rowsReview: reviewRows,
          rowsRejected: invalidRows,
        },
        completedAt: new Date(),
      },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
  }

  private async processRow(
    uploadJobId: string,
    sellerId: string,
    sellerName: string,
    sellerStatus: string,
    warehouseId: string,
    row: ParsedUploadRow,
    defaults: {
      defaultPartSource: string;
      defaultQualityTier: string;
      defaultBrand?: string;
      defaultCurrency?: string;
      defaultWeightUnit?: string;
      defaultDimensionUnit?: string;
      fileName: string;
      fileChecksum: string;
    },
  ) {
    const raw = row.raw;
    const brand = raw.brand?.trim() || defaults.defaultBrand || raw.__suggestedBrand || undefined;
    const manufacturerPartNumber = raw.manufacturerPartNumber?.trim() || raw.mpn?.trim();
    const description = raw.description?.trim() || raw.title?.trim();
    const title = raw.title?.trim()
      || (description && manufacturerPartNumber ? `${brand ? `${brand} ` : ''}${description} – ${manufacturerPartNumber}` : undefined)
      || (brand && manufacturerPartNumber ? `${brand} Part – ${manufacturerPartNumber}` : undefined);
    if (!title || !manufacturerPartNumber) {
      const missing = [!title ? 'Missing title/description and identity fallback' : '', !manufacturerPartNumber ? 'Missing manufacturer/OEM part number' : ''].filter(Boolean);
      await this.createUploadRow(uploadJobId, row, 'INVALID', missing);
      return { status: 'INVALID', message: missing.join('; ') };
    }

    const primaryCurrency = raw.priceAed ? 'AED' : raw.priceUsd ? 'USD' : raw.currency?.trim() || defaults.defaultCurrency || '';
    const priceText = raw.priceAed || raw.priceUsd || raw.price || '';
    const price = priceText ? Number(priceText.replace(/[$,\s]/g, '')) : 0;
    const stockSharjah = raw.stockSharjah === undefined || raw.stockSharjah === '' ? null : parseInt(raw.stockSharjah, 10);
    const stockJebelAli = raw.stockJebelAli === undefined || raw.stockJebelAli === '' ? null : parseInt(raw.stockJebelAli, 10);
    const quantity = raw.quantity !== undefined && raw.quantity !== ''
      ? parseInt(raw.quantity, 10)
      : [stockSharjah, stockJebelAli].some((value) => value !== null)
        ? (stockSharjah ?? 0) + (stockJebelAli ?? 0)
        : 0;
    const imageUrls = (raw.imageUrls || '')
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean);
    const parsedOemReferences = parseCompoundOemReferences(raw.oemReferences || raw.oemPartNumber || '');
    const oeNumbers = [
      ...parsedOemReferences.map((reference) => reference.displayNumber),
      ...extractOeNumbers(title),
    ].filter((v): v is string => Boolean(v?.trim()));
    const parsedVehicle = parseVehicleFromTitle(title);
    const category = raw.category?.trim() || extractCategory(title);
    const classification = classifyPart({
      declaredType: raw.partType || raw.__suggestedPartType || defaults.defaultPartSource,
      brand,
      condition: raw.condition,
      sourceContext: raw.__template === 'FEBEST_AVAILABILITY' ? 'AFTERMARKET_CATALOG' : raw.__template === 'DXB_EXW' ? 'MIXED_CATALOG' : undefined,
    });
    const partSource = classification.partType === 'AFTERMARKET' ? 'AFTERMARKET' : 'OEM';
    const qualityTier = normalizeQualityTier(raw.condition || defaults.defaultQualityTier);
    const reviewReasons = this.buildReviewReasons({
      title,
      price,
      quantity,
      imageUrls,
      oeNumbers,
      parsedVehicle,
      partSource,
      brand,
    });
    if (!primaryCurrency) reviewReasons.push('Price currency requires confirmation');
    if (raw.__template === 'FEBEST_AVAILABILITY' && !defaults.defaultWeightUnit) reviewReasons.push('Weight unit requires confirmation');
    if (raw.__template === 'FEBEST_AVAILABILITY' && !defaults.defaultDimensionUnit) reviewReasons.push('Dimension unit requires confirmation');
    if (classification.status !== 'READY') reviewReasons.push(...classification.reasons);
    for (const reference of parsedOemReferences) if (reference.reviewReason) reviewReasons.push(`${reference.raw}: ${reference.reviewReason}`);
    const status = reviewReasons.length > 0 ? 'NEEDS_REVIEW' : 'IMPORTED';

    const normalizedMpn = normalizePartNumber(manufacturerPartNumber);
    const brandMaster = brand ? await this.prisma.brandMaster.upsert({
      where: { canonicalName: normalizeMasterName(brand) },
      update: { displayName: brand },
      create: {
        canonicalName: normalizeMasterName(brand),
        displayName: brand,
        brandTypes: classification.partType === 'AFTERMARKET' ? ['AFTERMARKET'] : [],
        isAftermarketBrand: classification.partType === 'AFTERMARKET',
        requiresManualReview: classification.status !== 'READY',
      },
    }) : null;
    const existingNumber = await this.prisma.catalogPartNumber.findFirst({
      where: { normalizedNumber: normalizedMpn, numberType: 'BRAND_MPN', brandId: brandMaster?.id ?? null },
      include: { canonicalPart: true },
    });
    const canonicalPart = existingNumber?.canonicalPart ?? await this.prisma.canonicalPart.create({
      data: {
        title,
        normalizedTitle: title.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(),
        description: description || null,
        brand: brand || null,
        manufacturer: brand || null,
        primaryBrandId: brandMaster?.id,
        manufacturerPartNumber,
        category,
        oeNumbers: Array.from(new Set(oeNumbers.map((v) => v.toUpperCase()))),
        fitmentFlags: reviewReasons,
        imageUrls,
        compatibility: parsedVehicle ? ({ source: 'title_parse', vehicle: parsedVehicle } as any) : undefined,
        partSource,
        partType: classification.partType,
        classificationStatus: classification.status,
        classificationConfidence: classification.confidence,
        classificationReason: classification.reasons.join('; '),
        qualityTier,
        fitmentStatus: parsedVehicle ? (status === 'IMPORTED' ? 'AUTO_MATCHED' : 'NEEDS_REVIEW') : 'NEEDS_REVIEW',
        fitmentConfidence: parsedVehicle ? 0.5 : 0,
      },
    });

    const existingMpn = await this.prisma.catalogPartNumber.findFirst({ where: {
      canonicalPartId: canonicalPart.id, numberType: 'BRAND_MPN', normalizedNumber: normalizedMpn,
      brandId: brandMaster?.id ?? null, vehicleMakeId: null,
    }});
    if (existingMpn) await this.prisma.catalogPartNumber.update({ where: { id: existingMpn.id }, data: { displayNumber: manufacturerPartNumber } });
    else await this.prisma.catalogPartNumber.create({ data: {
        canonicalPartId: canonicalPart.id,
        displayNumber: manufacturerPartNumber,
        normalizedNumber: normalizedMpn,
        numberType: 'BRAND_MPN',
        brandId: brandMaster?.id,
        source: 'SELLER_SPREADSHEET',
        verificationStatus: raw.__template === 'FEBEST_AVAILABILITY' ? 'SELLER_DECLARED' : 'UNVERIFIED',
        confidence: raw.__template === 'FEBEST_AVAILABILITY' ? 0.96 : 0.55,
      },
    });

    for (const reference of parsedOemReferences) {
      const make = reference.canonicalMake ? await this.prisma.vehicleMake.upsert({
        where: { name: reference.canonicalMake }, update: {}, create: { name: reference.canonicalMake, canonicalName: reference.canonicalMake, displayName: reference.canonicalMake },
      }) : null;
      const existingReference = await this.prisma.catalogPartNumber.findFirst({ where: {
        canonicalPartId: canonicalPart.id,
        numberType: 'OEM_CROSS_REFERENCE',
        normalizedNumber: reference.normalizedNumber,
        brandId: null,
        vehicleMakeId: make?.id ?? null,
      }});
      if (existingReference) await this.prisma.catalogPartNumber.update({ where: { id: existingReference.id }, data: { displayNumber: reference.displayNumber, confidence: reference.confidence } });
      else await this.prisma.catalogPartNumber.create({ data: {
          canonicalPartId: canonicalPart.id,
          displayNumber: reference.displayNumber,
          normalizedNumber: reference.normalizedNumber,
          numberType: 'OEM_CROSS_REFERENCE',
          vehicleMakeId: make?.id,
          source: 'SELLER_SPREADSHEET',
          verificationStatus: 'SELLER_DECLARED',
          confidence: reference.confidence,
          metadata: { raw: reference.raw, namespaceType: reference.namespaceType },
        },
      });
    }

    const sellerBasePrice = Number.isFinite(price) && price > 0 ? price : 0;
    const priceQuote = await this.pricing.quote(sellerId, category, sellerBasePrice);
    const offerSourceKey = deterministicSourceKey('SPREADSHEET', sellerId, defaults.fileChecksum, row.sheetName, row.rowNumber);
    const offerData = {
        sellerId,
        canonicalPartId: canonicalPart.id,
        price: priceQuote.customerPrice,
        sellerBasePrice: priceQuote.sellerBasePrice,
        marketplaceFee: priceQuote.marketplaceFee,
        sellerProceeds: priceQuote.sellerProceeds,
        pricingPolicyId: priceQuote.pricingPolicyId,
        pricingPolicyVersion: priceQuote.pricingPolicyVersion,
        pricedAt: new Date(),
        currency: priceQuote.pricingPolicyId ? priceQuote.currency : primaryCurrency || 'AED',
        condition: qualityTier,
        partSource,
        partType: classification.partType,
        qualityTier,
        sellerSku: raw.sku?.trim() || raw.sourceCode?.trim() || manufacturerPartNumber,
        sellerTitle: title,
        moq: raw.moq ? Math.max(1, parseInt(raw.moq, 10) || 1) : 1,
        externalOfferId: raw.sku?.trim() || manufacturerPartNumber,
        sourceKey: offerSourceKey,
        status: quantity === 0 ? 'OUT_OF_STOCK' : status === 'IMPORTED' && sellerStatus === 'ACTIVE' ? 'ACTIVE' : 'REVIEW',
    };
    const existingOffer = await this.prisma.sellerOffer.findUnique({ where: { sourceKey: offerSourceKey } });
    const offer = existingOffer
      ? await this.prisma.sellerOffer.update({ where: { id: existingOffer.id }, data: offerData })
      : await this.prisma.sellerOffer.create({ data: offerData });

    const inventoryRows: Array<{ warehouseId: string; quantity: number }> = [];
    if (stockSharjah !== null || stockJebelAli !== null) {
      const sharjah = await this.findOrCreateWarehouse(sellerId, 'SHARJAH', 'Sharjah');
      const jebelAli = await this.findOrCreateWarehouse(sellerId, 'JEBEL_ALI', 'Jebel Ali');
      inventoryRows.push({ warehouseId: sharjah.id, quantity: Math.max(0, stockSharjah ?? 0) });
      inventoryRows.push({ warehouseId: jebelAli.id, quantity: Math.max(0, stockJebelAli ?? 0) });
    } else {
      inventoryRows.push({ warehouseId, quantity: Math.max(0, Number.isFinite(quantity) ? quantity : 0) });
    }
    for (const inventory of inventoryRows) {
      await this.prisma.inventory.upsert({
        where: { warehouseId_offerId: { warehouseId: inventory.warehouseId, offerId: offer.id } },
        update: { quantity: inventory.quantity, status: inventory.quantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK' },
        create: { ...inventory, offerId: offer.id, status: inventory.quantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK' },
      });
    }

    const sourceKey = deterministicSourceKey('SPREADSHEET_ROW', sellerId, defaults.fileChecksum, row.sheetName, row.rowNumber);
    await this.prisma.sourceRecord.upsert({
      where: { sourceKey },
      update: {
        canonicalPartId: canonicalPart.id,
        sellerOfferId: offer.id,
        rawPayload: row.original || raw,
        transformations: { template: raw.__template, normalizedMpn, parsedOemReferences, classification } as any,
        classificationConfidence: classification.confidence,
        lastSyncedAt: new Date(),
      },
      create: {
        sourceType: 'SPREADSHEET_ROW', sourcePlatform: 'SELLER_UPLOAD', sellerId,
        canonicalPartId: canonicalPart.id, sellerOfferId: offer.id,
        sourceFileName: defaults.fileName, sourceSheet: row.sheetName, sourceRowNumber: row.rowNumber,
        sourceKey, rawPayload: row.original || raw,
        transformations: { template: raw.__template, normalizedMpn, parsedOemReferences, classification } as any,
        classificationConfidence: classification.confidence,
      },
    });

    for (const [currency, amountText] of [['USD', raw.priceUsd], ['AED', raw.priceAed]] as const) {
      if (!amountText) continue;
      const amount = Number(amountText.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      await this.prisma.offerPrice.upsert({
        where: { offerId_currency: { offerId: offer.id, currency } },
        update: { amount, isPrimary: currency === primaryCurrency, exchangeRate: raw.priceUsd && raw.priceAed ? Number(raw.priceAed) / Number(raw.priceUsd) : undefined, rateSource: 'SELLER_SPREADSHEET' },
        create: { offerId: offer.id, currency, amount, isPrimary: currency === primaryCurrency, exchangeRate: raw.priceUsd && raw.priceAed ? Number(raw.priceAed) / Number(raw.priceUsd) : undefined, rateSource: 'SELLER_SPREADSHEET' },
      });
    }

    const fitments = parsedVehicle
      ? [{
          vehicleConfigId: (await this.findOrCreateVehicleConfig(parsedVehicle)).id,
          evidenceLevel: 'D',
          confidence: 0.5,
        }]
      : [];

    if (parsedVehicle && fitments[0]) {
      await this.prisma.fitment.upsert({
        where: { canonicalPartId_vehicleConfigId: { canonicalPartId: canonicalPart.id, vehicleConfigId: fitments[0].vehicleConfigId } },
        update: {},
        create: {
          canonicalPartId: canonicalPart.id,
          vehicleConfigId: fitments[0].vehicleConfigId,
          evidenceLevel: 'D',
          confidence: 0.5,
          reviewer: 'Seller upload auto-match',
        },
      });
    }

    await this.search.indexPart({
      id: canonicalPart.id,
      title: canonicalPart.title,
      partType: canonicalPart.partType,
      brand: canonicalPart.brand,
      manufacturerPartNumber: canonicalPart.manufacturerPartNumber,
      partNumbers: [
        { displayNumber: manufacturerPartNumber, normalizedNumber: normalizedMpn, numberType: 'BRAND_MPN', brand },
        ...parsedOemReferences.map((reference) => ({ displayNumber: reference.displayNumber, normalizedNumber: reference.normalizedNumber, numberType: 'OEM_CROSS_REFERENCE', make: reference.canonicalMake })),
      ],
      category: canonicalPart.category,
      oeNumbers: canonicalPart.oeNumbers,
      imageUrls: canonicalPart.imageUrls,
      compatibility: canonicalPart.compatibility,
      partSource: canonicalPart.partSource,
      qualityTier: canonicalPart.qualityTier,
      fitmentStatus: canonicalPart.fitmentStatus,
      fitmentConfidence: canonicalPart.fitmentConfidence,
      createdAt: canonicalPart.createdAt,
      fitments,
      offers: [{
        id: offer.id,
        price: offer.price,
        condition: offer.condition,
        partSource: offer.partSource,
        qualityTier: offer.qualityTier,
        sellerId: offer.sellerId,
        sellerName,
      }],
    });

    await this.createUploadRow(uploadJobId, row, status, reviewReasons, {
      canonicalPartId: canonicalPart.id,
      sellerOfferId: offer.id,
      title,
      brand: canonicalPart.brand,
      category,
      oemPartNumber: oeNumbers[0],
      partSource,
      qualityTier,
      condition: qualityTier,
      price: offer.price,
      quantity: Math.max(0, Number.isFinite(quantity) ? quantity : 0),
      currency: offer.currency,
      imageUrls,
      fitmentSummary: parsedVehicle,
      sourceKey,
      normalizedData: { normalizedMpn, parsedOemReferences },
      classificationConfidence: classification.confidence,
      classificationReason: classification.reasons.join('; '),
      matchConfidence: existingNumber ? 1 : 0,
    });

    return { status, message: reviewReasons.join('; ') };
  }

  private buildReviewReasons(input: {
    title: string;
    price: number;
    quantity: number;
    imageUrls: string[];
    oeNumbers: string[];
    parsedVehicle: ParsedVehicle | null;
    partSource: string;
    brand?: string;
  }) {
    const reasons: string[] = [];
    if (!Number.isFinite(input.price) || input.price <= 0) reasons.push('Missing or invalid price');
    if (!Number.isFinite(input.quantity) || input.quantity < 0) reasons.push('Missing or invalid quantity');
    if (input.imageUrls.length === 0) reasons.push('Missing product images');
    if (input.oeNumbers.length === 0) reasons.push('Missing OE/OEM or manufacturer part number');
    if (!input.parsedVehicle) reasons.push('Vehicle compatibility could not be inferred');
    if (input.partSource === 'AFTERMARKET' && !input.brand?.trim()) reasons.push('Aftermarket part needs brand/manufacturer');
    return reasons;
  }

  private async createUploadRow(
    uploadJobId: string,
    row: ParsedUploadRow,
    status: string,
    reviewReasons: string[],
    extra: Partial<{
      canonicalPartId: string;
      sellerOfferId: string;
      title: string;
      brand: string | null;
      category: string | null;
      oemPartNumber: string;
      partSource: string;
      qualityTier: string;
      condition: string;
      price: number;
      quantity: number;
      currency: string;
      imageUrls: string[];
      fitmentSummary: unknown;
      sourceKey: string;
      normalizedData: unknown;
      classificationConfidence: number;
      classificationReason: string;
      matchConfidence: number;
    }> = {},
  ) {
    return this.prisma.sellerUploadRow.create({
      data: {
        uploadJobId,
        rowNumber: row.rowNumber,
        status,
        sku: row.raw.sku || null,
        title: extra.title || row.raw.title || null,
        brand: extra.brand || row.raw.brand || null,
        category: extra.category || row.raw.category || null,
        oemPartNumber: extra.oemPartNumber || row.raw.oemPartNumber || row.raw.mpn || null,
        partSource: extra.partSource || 'OEM',
        qualityTier: extra.qualityTier || 'USED',
        condition: extra.condition || 'USED',
        price: extra.price,
        quantity: extra.quantity ?? 1,
        currency: extra.currency || row.raw.currency || 'AED',
        imageUrls: extra.imageUrls || [],
        fitmentSummary: extra.fitmentSummary === undefined ? undefined : (extra.fitmentSummary as any),
        reviewReasons,
        message: reviewReasons.join('; ') || null,
        rawData: row.original || row.raw,
        sourceKey: extra.sourceKey,
        normalizedData: extra.normalizedData === undefined ? undefined : (extra.normalizedData as any),
        classificationConfidence: extra.classificationConfidence,
        classificationReason: extra.classificationReason,
        matchConfidence: extra.matchConfidence,
        canonicalPartId: extra.canonicalPartId,
        sellerOfferId: extra.sellerOfferId,
      },
    });
  }

  async reviewRow(rowId: string, body: { status: string; offerStatus?: string; notes?: string }) {
    const row = await this.prisma.sellerUploadRow.findUnique({ where: { id: rowId } });
    if (!row) throw new NotFoundException('Upload row not found');

    if (row.sellerOfferId && body.offerStatus) {
      if (body.offerStatus === 'ACTIVE') {
        const offer = await this.prisma.sellerOffer.findUnique({
          where: { id: row.sellerOfferId },
          include: { seller: true },
        });
        if (offer?.seller.onboardingStatus !== 'ACTIVE') {
          throw new BadRequestException('Seller must be ACTIVE before an offer can be activated');
        }
      }
      await this.prisma.sellerOffer.update({
        where: { id: row.sellerOfferId },
        data: { status: body.offerStatus },
      });
    }

    return this.prisma.sellerUploadRow.update({
      where: { id: rowId },
      data: {
        status: body.status,
        message: body.notes ?? row.message,
        reviewReasons: body.status === 'APPROVED' ? [] : Array.isArray(row.reviewReasons) ? row.reviewReasons : [],
      },
    });
  }

  private async findOrCreateWarehouse(sellerId: string, externalKey: string, name: string) {
    const existing = await this.prisma.warehouse.findFirst({ where: { sellerId, externalKey } });
    if (existing) return existing;
    return this.prisma.warehouse.create({
      data: { sellerId, externalKey, name, location: name },
    });
  }

  private async findOrCreateVehicleConfig(vehicle: ParsedVehicle) {
    const make = await this.prisma.vehicleMake.upsert({
      where: { name: vehicle.make },
      update: {},
      create: { name: vehicle.make },
    });

    let model = await this.prisma.vehicleModel.findFirst({
      where: { makeId: make.id, name: vehicle.model },
    });
    if (!model) {
      model = await this.prisma.vehicleModel.create({
        data: { makeId: make.id, name: vehicle.model },
      });
    }

    let generation = await this.prisma.vehicleGeneration.findFirst({
      where: {
        modelId: model.id,
        startYear: { lte: vehicle.endYear },
        endYear: { gte: vehicle.startYear },
      },
    });
    if (!generation) {
      generation = await this.prisma.vehicleGeneration.create({
        data: {
          modelId: model.id,
          name: vehicle.startYear === vehicle.endYear ? `${vehicle.startYear}` : `${vehicle.startYear}-${vehicle.endYear}`,
          startYear: vehicle.startYear,
          endYear: vehicle.endYear,
        },
      });
    }

    let config = await this.prisma.vehicleConfiguration.findFirst({
      where: { generationId: generation.id },
    });
    if (!config) {
      config = await this.prisma.vehicleConfiguration.create({
        data: { generationId: generation.id, market: 'GLOBAL' },
      });
    }
    return config;
  }
}
