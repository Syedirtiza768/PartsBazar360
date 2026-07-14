import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import {
  extractCategory,
  extractOeNumbers,
  parseVehicleFromTitle,
} from '../ingestion/listing-parser.util';
import type { ParsedVehicle } from '../ingestion/listing-parser.util';

interface ParsedUploadRow {
  rowNumber: number;
  raw: Record<string, string>;
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
    opts: { defaultPartSource?: string; defaultQualityTier?: string },
  ) {
    if (!sellerId) throw new BadRequestException('sellerId is required');
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: { warehouses: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');

    const parsedRows = parseDelimitedFile(buffer);
    if (parsedRows.length === 0) {
      throw new BadRequestException('Upload file must contain a header row and at least one data row');
    }

    const defaultPartSource = normalizePartSource(opts.defaultPartSource);
    const defaultQualityTier = normalizeQualityTier(opts.defaultQualityTier);
    const job = await this.prisma.sellerUploadJob.create({
      data: {
        sellerId,
        fileName,
        status: 'PROCESSING',
        totalRows: parsedRows.length,
        defaultPartSource,
        defaultQualityTier,
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
      const result = await this.processRow(job.id, sellerId, seller.name, warehouse.id, row, {
        defaultPartSource,
        defaultQualityTier,
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
        completedAt: new Date(),
      },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
  }

  private async processRow(
    uploadJobId: string,
    sellerId: string,
    sellerName: string,
    warehouseId: string,
    row: ParsedUploadRow,
    defaults: { defaultPartSource: string; defaultQualityTier: string },
  ) {
    const raw = row.raw;
    const title = raw.title?.trim();
    if (!title) {
      await this.createUploadRow(uploadJobId, row, 'INVALID', ['Missing title']);
      return { status: 'INVALID', message: 'Missing title' };
    }

    const price = raw.price ? Number(raw.price.replace(/[$,\s]/g, '')) : 0;
    const quantity = raw.quantity ? parseInt(raw.quantity, 10) : 1;
    const imageUrls = (raw.imageUrls || '')
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean);
    const oeNumbers = [
      raw.oemPartNumber,
      raw.mpn,
      ...extractOeNumbers(title),
    ].filter((v): v is string => Boolean(v?.trim()));
    const parsedVehicle = parseVehicleFromTitle(title);
    const category = raw.category?.trim() || extractCategory(title);
    const partSource = normalizePartSource(raw.partType || defaults.defaultPartSource);
    const qualityTier = normalizeQualityTier(raw.condition || defaults.defaultQualityTier);
    const reviewReasons = this.buildReviewReasons({
      title,
      price,
      quantity,
      imageUrls,
      oeNumbers,
      parsedVehicle,
      partSource,
      brand: raw.brand,
    });
    const status = reviewReasons.length > 0 ? 'NEEDS_REVIEW' : 'IMPORTED';

    const canonicalPart = await this.prisma.canonicalPart.create({
      data: {
        title,
        brand: raw.brand?.trim() || parsedVehicle?.make || null,
        manufacturer: raw.brand?.trim() || null,
        category,
        oeNumbers: Array.from(new Set(oeNumbers.map((v) => v.toUpperCase()))),
        fitmentFlags: reviewReasons,
        imageUrls,
        compatibility: parsedVehicle ? ({ source: 'title_parse', vehicle: parsedVehicle } as any) : undefined,
        partSource,
        qualityTier,
        fitmentStatus: parsedVehicle ? (status === 'IMPORTED' ? 'AUTO_MATCHED' : 'NEEDS_REVIEW') : 'NEEDS_REVIEW',
        fitmentConfidence: parsedVehicle ? 0.5 : 0,
      },
    });

    const offer = await this.prisma.sellerOffer.create({
      data: {
        sellerId,
        canonicalPartId: canonicalPart.id,
        price: Number.isFinite(price) && price > 0 ? price : 0,
        currency: raw.currency?.trim() || 'AED',
        condition: qualityTier,
        partSource,
        qualityTier,
        externalOfferId: raw.sku?.trim() || null,
        status: status === 'IMPORTED' ? 'ACTIVE' : 'REVIEW',
      },
    });

    await this.prisma.inventory.create({
      data: {
        warehouseId,
        offerId: offer.id,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      },
    });

    const fitments = parsedVehicle
      ? [{ vehicleConfigId: (await this.findOrCreateVehicleConfig(parsedVehicle)).id }]
      : [];

    if (parsedVehicle && fitments[0]) {
      await this.prisma.fitment.create({
        data: {
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
      brand: canonicalPart.brand,
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
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      currency: offer.currency,
      imageUrls,
      fitmentSummary: parsedVehicle,
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
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) reasons.push('Missing or invalid quantity');
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
        rawData: row.raw,
        canonicalPartId: extra.canonicalPartId,
        sellerOfferId: extra.sellerOfferId,
      },
    });
  }

  async reviewRow(rowId: string, body: { status: string; offerStatus?: string; notes?: string }) {
    const row = await this.prisma.sellerUploadRow.findUnique({ where: { id: rowId } });
    if (!row) throw new NotFoundException('Upload row not found');

    if (row.sellerOfferId && body.offerStatus) {
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
