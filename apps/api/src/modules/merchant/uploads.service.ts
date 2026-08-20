import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import { SearchOutboxService } from '../search/index/search-outbox.service';
import {
  extractCategory,
  extractOeNumbers,
  parseVehicleFromTitle,
} from '../ingestion/listing-parser.util';
import type { ParsedVehicle } from '../ingestion/listing-parser.util';
import { PricingService } from '../pricing/pricing.service';
import { createHash } from 'node:crypto';
import { SpreadsheetParserService, type ImportTemplate } from '../catalog-import/spreadsheet-parser.service';
import { classifyPart } from '../catalog-import/classification.util';
import { parseCompoundOemReferences } from '../catalog-import/oem-reference.parser';
import { canonicalizeCatalogBrand } from '../catalog-import/catalog-identity.util';
import {
  deterministicSourceKey,
  normalizeMasterName,
  normalizePartNumber,
} from '../catalog-import/part-normalization.util';
import { tagFromTemplate, type SourceTag } from '../catalog-import/source-tag.util';
import { CatalogMatchService } from '../catalog-import/catalog-match.service';
import { ReviewTaskService } from '../catalog-import/review-task.service';
import { CatalogAuditService } from '../catalog-import/catalog-audit.service';
import { resolveShippingMetrics } from '../catalog-import/weight-normalizer';
import { resolvePartClassKey } from '../checkout/part-class-weights';
import {
  deriveBillableWeight,
  parseDimensionsJson,
  resolveItemWeight,
} from '../checkout/billable-weight.util';
import { partTypeFromLegacy } from '@repo/catalog-contracts';
import { resolveVehicleConfiguration } from '../vehicle/vehicle-config-identity.util';

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
  if (raw.includes('FOR PART') || raw.includes('NOT WORKING'))
    return 'FOR_PARTS';
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
      const mapped =
        HEADER_MAP[normalizeHeader(header)] ||
        HEADER_MAP[header.toLowerCase().trim()];
      if (mapped && cells[i]) raw[mapped] = cells[i];
    });
    return { rowNumber: index + 2, raw };
  });
}

@Injectable()
export class MerchantUploadsService {
  private readonly logger = new Logger(MerchantUploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: OpenSearchService,
    private readonly searchOutbox: SearchOutboxService,
    private readonly pricing: PricingService,
    private readonly spreadsheetParser: SpreadsheetParserService,
    private readonly catalogMatch: CatalogMatchService,
    private readonly reviewTasks: ReviewTaskService,
    private readonly audit: CatalogAuditService,
  ) {}

  async listJobs(sellerId: string) {
    if (!sellerId)
      throw new BadRequestException('sellerId query parameter is required');
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
      /** IMMEDIATE (default/seed) commits live; STAGED waits for preview/commit. */
      commitMode?: 'IMMEDIATE' | 'STAGED';
      catalogType?: string;
    },
  ) {
    if (!sellerId) throw new BadRequestException('sellerId is required');
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: { warehouses: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');

    const parsedSheets = await this.spreadsheetParser.parse(fileName, buffer);
    const parsedRows: ParsedUploadRow[] = parsedSheets.flatMap((sheet) =>
      sheet.rows.map((row) => ({
        ...row,
        raw: {
          ...row.raw,
          __template: sheet.template,
          __suggestedBrand: sheet.suggestedDefaults.brand || '',
          __suggestedPartType: sheet.suggestedDefaults.partType || '',
        },
      })),
    );
    if (parsedRows.length === 0) {
      throw new BadRequestException(
        'Upload file must contain a header row and at least one data row',
      );
    }

    const defaultPartSource = normalizePartSource(opts.defaultPartSource);
    const defaultQualityTier = normalizeQualityTier(opts.defaultQualityTier);
    const commitMode = opts.commitMode === 'STAGED' ? 'STAGED' : 'IMMEDIATE';
    const fileChecksum = createHash('sha256').update(buffer).digest('hex');
    const existingJob = await this.prisma.sellerUploadJob.findFirst({
      where: { sellerId, fileChecksum },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (
      existingJob?.status === 'COMPLETED' ||
      existingJob?.status === 'NEEDS_REVIEW' ||
      existingJob?.status === 'PREVIEW_READY'
    ) {
      return existingJob;
    }

    const sanitizeHeaders = (headers: string[]) =>
      headers.map((header, index) =>
        header && header.trim() ? header : `column_${index + 1}`,
      );

    const detection = {
      sheets: parsedSheets.map((sheet) => ({
        sheet: sheet.sheetName,
        template: sheet.template,
        headers: sanitizeHeaders(sheet.headers),
        rowCount: sheet.rows.length,
        suggestedDefaults: sheet.suggestedDefaults,
      })),
      fileChecksum,
    };

    const job = await this.prisma.sellerUploadJob.create({
      data: {
        sellerId,
        fileName,
        status: commitMode === 'STAGED' ? 'STAGING' : 'PROCESSING',
        totalRows: parsedRows.length,
        defaultPartSource,
        defaultQualityTier,
        fileChecksum,
        mimeType: fileName.toLowerCase().endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
        sourceSheet:
          parsedSheets.length === 1 ? parsedSheets[0].sheetName : null,
        defaultBrand:
          opts.defaultBrand || parsedSheets[0]?.suggestedDefaults.brand || null,
        defaultCurrency: opts.defaultCurrency || null,
        defaultWeightUnit: opts.defaultWeightUnit || null,
        defaultDimensionUnit: opts.defaultDimensionUnit || null,
        commitMode,
        catalogType:
          opts.catalogType ||
          (parsedSheets[0]?.template === 'FEBEST_AVAILABILITY' ||
          parsedSheets[0]?.template === 'DYNATRADE_STOCK'
            ? 'AFTERMARKET'
            : parsedSheets[0]?.template === 'DXB_EXW'
              ? 'MIXED'
              : null),
        detection,
        mapping: parsedSheets.map((sheet) => ({
          sheet: sheet.sheetName,
          template: sheet.template,
          headers: sanitizeHeaders(sheet.headers),
        })),
      },
    });

    const warehouse =
      seller.warehouses[0] ??
      (await this.prisma.warehouse.create({
        data: {
          sellerId,
          name: `${seller.name} Default Warehouse`,
          location: 'Marketplace intake',
        },
      }));

    // Fire-and-forget: process rows in background so the HTTP response returns immediately.
    this.processUploadRowsBackground(job.id, sellerId, parsedRows, parsedSheets, {
      defaultPartSource,
      defaultQualityTier,
      defaultBrand: opts.defaultBrand,
      defaultCurrency: opts.defaultCurrency,
      defaultWeightUnit: opts.defaultWeightUnit,
      defaultDimensionUnit: opts.defaultDimensionUnit,
      fileName,
      fileChecksum,
      commitMode,
    }).catch((err) => {
      this.logger.error(`Background upload processing failed for ${job.id}: ${err?.message}`);
    });

    return this.prisma.sellerUploadJob.findUnique({
      where: { id: job.id },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
  }

  private async processUploadRowsBackground(
    jobId: string,
    sellerId: string,
    parsedRows: ParsedUploadRow[],
    parsedSheets: any[],
    opts: {
      defaultPartSource: string;
      defaultQualityTier: string;
      defaultBrand?: string;
      defaultCurrency?: string;
      defaultWeightUnit?: string;
      defaultDimensionUnit?: string;
      fileName: string;
      fileChecksum: string;
      commitMode?: 'IMMEDIATE' | 'STAGED';
    },
  ) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: { warehouses: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    const warehouse =
      seller.warehouses[0] ??
      (await this.prisma.warehouse.create({
        data: {
          sellerId,
          name: `${seller.name} Default Warehouse`,
          location: 'Marketplace intake',
        },
      }));

    let insertedRows = 0;
    let reviewRows = 0;
    let invalidRows = 0;
    const warnings: string[] = [];
    const preview = {
      productsCreate: 0,
      productsMatch: 0,
      offersUpsert: 0,
      oemReferences: 0,
      unrecognizedMakes: [] as string[],
      ambiguousClassifications: 0,
    };

    for (const row of parsedRows) {
      const result = await this.processRow(
        jobId,
        sellerId,
        seller.name,
        seller.onboardingStatus,
        warehouse.id,
        row,
        {
          defaultPartSource: opts.defaultPartSource,
          defaultQualityTier: opts.defaultQualityTier,
          defaultBrand: opts.defaultBrand || parsedSheets[0]?.suggestedDefaults.brand,
          defaultCurrency: opts.defaultCurrency,
          defaultWeightUnit: opts.defaultWeightUnit,
          defaultDimensionUnit: opts.defaultDimensionUnit,
          fileName: opts.fileName,
          fileChecksum: opts.fileChecksum,
          commitMode: opts.commitMode,
          preview,
        },
      );
      if (result.status === 'INVALID') invalidRows++;
      else if (result.status === 'NEEDS_REVIEW' || result.status === 'STAGED') {
        if (result.status === 'NEEDS_REVIEW') reviewRows++;
        else if (opts.commitMode === 'STAGED' && result.needsReview) reviewRows++;
        else insertedRows++;
      } else insertedRows++;
      if (result.message)
        warnings.push(`Row ${row.rowNumber}: ${result.message}`);
    }

    const finalStatus =
      invalidRows === parsedRows.length
        ? 'FAILED'
        : opts.commitMode === 'STAGED'
          ? 'PREVIEW_READY'
          : reviewRows > 0
            ? 'NEEDS_REVIEW'
            : 'COMPLETED';

    await this.prisma.sellerUploadJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        processedRows: parsedRows.length,
        insertedRows,
        reviewRows,
        invalidRows,
        warnings,
        preview,
        report: {
          filesProcessed: 1,
          sheetsProcessed: parsedSheets.length,
          rowsRead: parsedRows.length,
          rowsImported: opts.commitMode === 'IMMEDIATE' ? insertedRows : 0,
          rowsStaged: opts.commitMode === 'STAGED' ? parsedRows.length - invalidRows : 0,
          rowsReview: reviewRows,
          rowsRejected: invalidRows,
          preview,
          commitMode: opts.commitMode,
        },
        completedAt: opts.commitMode === 'IMMEDIATE' ? new Date() : null,
      },
    });

    this.logger.log(
      `Upload ${jobId} completed: ${insertedRows} inserted, ${reviewRows} review, ${invalidRows} invalid`,
    );
  }

  async updateMapping(
    jobId: string,
    mapping: unknown,
    defaults?: {
      defaultBrand?: string;
      defaultCurrency?: string;
      defaultWeightUnit?: string;
      defaultDimensionUnit?: string;
      catalogType?: string;
    },
  ) {
    const job = await this.prisma.sellerUploadJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Upload job not found');
    return this.prisma.sellerUploadJob.update({
      where: { id: jobId },
      data: {
        mapping: mapping as any,
        defaultBrand: defaults?.defaultBrand ?? job.defaultBrand,
        defaultCurrency: defaults?.defaultCurrency ?? job.defaultCurrency,
        defaultWeightUnit: defaults?.defaultWeightUnit ?? job.defaultWeightUnit,
        defaultDimensionUnit:
          defaults?.defaultDimensionUnit ?? job.defaultDimensionUnit,
        catalogType: defaults?.catalogType ?? job.catalogType,
        status: job.commitMode === 'STAGED' ? 'MAPPING' : job.status,
      },
    });
  }

  async commitJob(jobId: string) {
    const job = await this.getJob(jobId);
    if (job.commitMode !== 'STAGED') {
      throw new BadRequestException(
        'Only STAGED import jobs can be committed explicitly',
      );
    }
    if (
      !['PREVIEW_READY', 'NEEDS_REVIEW', 'MAPPING', 'STAGING'].includes(
        job.status,
      )
    ) {
      throw new BadRequestException(
        `Job status ${job.status} is not committable`,
      );
    }

    await this.prisma.sellerUploadJob.update({
      where: { id: jobId },
      data: { status: 'COMMITTING' },
    });

    // Fire-and-forget: process rows in background so the HTTP response returns immediately.
    this.commitJobBackground(jobId, job).catch((err) => {
      this.logger.error(`Background commit failed for ${jobId}: ${err?.message}`);
    });

    return { status: 'COMMITTING', jobId, message: 'Commit started in background' };
  }

  private async commitJobBackground(jobId: string, job: any) {

    const seller = await this.prisma.seller.findUnique({
      where: { id: job.sellerId },
      include: { warehouses: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    const warehouse = seller.warehouses[0];
    if (!warehouse) throw new BadRequestException('Seller has no warehouse');

    let insertedRows = 0;
    let reviewRows = 0;
    let invalidRows = 0;

    for (const row of job.rows) {
      if (row.status === 'INVALID' || row.status === 'REJECTED') {
        invalidRows++;
        continue;
      }
      if (row.status === 'IMPORTED' && row.canonicalPartId) {
        insertedRows++;
        continue;
      }
      const staged = (row.stagedPayload || row.normalizedData || {}) as Record<
        string,
        any
      >;
      const raw = (row.rawData || {}) as Record<string, string>;
      const result = await this.processRow(
        job.id,
        seller.id,
        seller.name,
        seller.onboardingStatus,
        warehouse.id,
        {
          rowNumber: row.rowNumber,
          sheetName: job.sourceSheet || undefined,
          // Build normalized raw from staged payload (string values only) + original rawData fallback.
          // stagedPayload has the normalized keys processRow expects (manufacturerPartNumber,
          // description, price, etc.) but also has non-string fields. Extract only string fields
          // and merge with rawData (which has original headers as fallback).
          raw: this.buildNormalizedRaw(staged, raw),
          original: raw,
        },
        {
          defaultPartSource: job.defaultPartSource,
          defaultQualityTier: job.defaultQualityTier,
          defaultBrand: job.defaultBrand || undefined,
          defaultCurrency: job.defaultCurrency || undefined,
          defaultWeightUnit: job.defaultWeightUnit || undefined,
          defaultDimensionUnit: job.defaultDimensionUnit || undefined,
          fileName: job.fileName,
          fileChecksum: job.fileChecksum || job.id,
          commitMode: 'IMMEDIATE',
          existingRowId: row.id,
        },
      );
      if (result.status === 'INVALID') invalidRows++;
      else if (result.status === 'NEEDS_REVIEW') reviewRows++;
      else insertedRows++;
    }

    await this.audit.record({
      action: 'IMPORT_COMMIT',
      entityType: 'SellerUploadJob',
      entityId: jobId,
      actorType: 'SELLER',
      actorId: seller.id,
      metadata: { insertedRows, reviewRows, invalidRows },
    });

    return this.prisma.sellerUploadJob.update({
      where: { id: jobId },
      data: {
        status:
          invalidRows === job.rows.length
            ? 'FAILED'
            : reviewRows > 0
              ? 'NEEDS_REVIEW'
              : 'COMPLETED',
        insertedRows,
        reviewRows,
        invalidRows,
        processedRows: job.rows.length,
        completedAt: new Date(),
        report: {
          ...(typeof job.report === 'object' && job.report
            ? (job.report as object)
            : {}),
          rowsImported: insertedRows,
          rowsReview: reviewRows,
          rowsRejected: invalidRows,
          committedAt: new Date().toISOString(),
        },
      },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
  }
  /** Build a string-only raw map from staged payload + original rawData fallback. */
  private buildNormalizedRaw(
    staged: Record<string, any>,
    raw: Record<string, string>,
  ): Record<string, string> {
    const out: Record<string, string> = { ...raw };
    // Map staged payload fields (normalized keys) to string values, skipping
    // nested objects/arrays and internal fields.
    const skip = new Set([
      'rawOverrides', 'autoMatchPartId', 'matchCandidates', 'classification',
      'partClassKey', 'primaryCurrency', 'billableWeightKg', 'weightConfidence',
      'dimensionalWeightKg', 'parsedOemReferences', 'dimensionsConfidence',
      'parsedVehicle', 'weightKg', 'dimensionsCm', 'matchCandidates',
      'stockSharjah', 'stockJebelAli',
    ]);
    for (const [k, v] of Object.entries(staged)) {
      if (skip.has(k)) continue;
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') {
        if (!out[k]) out[k] = v;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        if (!out[k]) out[k] = String(v);
      }
      // Skip arrays and objects — processRow can't handle them in raw
    }
    return out;
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
      commitMode?: 'IMMEDIATE' | 'STAGED';
      preview?: {
        productsCreate: number;
        productsMatch: number;
        offersUpsert: number;
        oemReferences: number;
        unrecognizedMakes: string[];
        ambiguousClassifications: number;
      };
      existingRowId?: string;
    },
  ) {
    const raw = row.raw;
    const brand =
      canonicalizeCatalogBrand(
        raw.brand?.trim() || defaults.defaultBrand || raw.__suggestedBrand,
      ) ?? undefined;
    const manufacturerPartNumber =
      raw.manufacturerPartNumber?.trim() ||
      raw.mpn?.trim() ||
      raw.oemPartNumber?.trim() ||
      (raw.oemReferences?.trim() || '').split(/[,;|]/)[0]?.trim() || undefined;
    const description = raw.description?.trim() || raw.title?.trim();
    const title =
      raw.title?.trim() ||
      (description && manufacturerPartNumber
        ? `${brand ? `${brand} ` : ''}${description} – ${manufacturerPartNumber}`
        : undefined) ||
      (brand && manufacturerPartNumber
        ? `${brand} Part – ${manufacturerPartNumber}`
        : undefined);
    if (!title || !manufacturerPartNumber) {
      const missing = [
        !title ? 'Missing title/description and identity fallback' : '',
        !manufacturerPartNumber ? 'Missing manufacturer/OEM part number' : '',
      ].filter(Boolean);
      await this.createUploadRow(
        uploadJobId,
        row,
        'INVALID',
        missing,
        {},
        defaults.existingRowId,
      );
      return {
        status: 'INVALID',
        message: missing.join('; '),
        needsReview: false,
      };
    }

    const preferredCurrency = (defaults.defaultCurrency || '').toUpperCase();
    const primaryCurrency =
      preferredCurrency === 'USD' && raw.priceUsd
        ? 'USD'
        : preferredCurrency === 'AED' && raw.priceAed
          ? 'AED'
          : raw.priceAed && preferredCurrency !== 'USD'
            ? 'AED'
            : raw.priceUsd
              ? 'USD'
              : raw.currency?.trim() || defaults.defaultCurrency || '';
    const priceText =
      preferredCurrency === 'USD'
        ? raw.priceUsd || raw.price || raw.priceAed || ''
        : preferredCurrency === 'AED'
          ? raw.priceAed || raw.price || raw.priceUsd || ''
          : raw.priceAed || raw.priceUsd || raw.price || '';
    const rawPrice = priceText ? Number(String(priceText).replace(/[$,\s]/g, '')) : 0;
    const MARGIN_DIVISOR = Number(process.env.PRICE_MARGIN_DIVISOR || '0.7');
    const price = MARGIN_DIVISOR > 0 && MARGIN_DIVISOR < 1
      ? Math.round((rawPrice / MARGIN_DIVISOR) * 100) / 100
      : rawPrice;
    const stockSharjah =
      raw.stockSharjah === undefined || raw.stockSharjah === ''
        ? null
        : parseInt(raw.stockSharjah, 10);
    const stockJebelAli =
      raw.stockJebelAli === undefined || raw.stockJebelAli === ''
        ? null
        : parseInt(raw.stockJebelAli, 10);
    const quantity =
      raw.quantity !== undefined && raw.quantity !== ''
        ? parseInt(raw.quantity, 10)
        : [stockSharjah, stockJebelAli].some((value) => value !== null)
          ? (stockSharjah ?? 0) + (stockJebelAli ?? 0)
          : 0;
    if (quantity <= 0) {
      await this.createUploadRow(
        uploadJobId,
        row,
        'SKIPPED',
        ['Zero or missing stock — excluded from live catalog'],
        {},
        defaults.existingRowId,
      );
      return {
        status: 'SKIPPED',
        message: 'Zero stock excluded',
        needsReview: false,
      };
    }
    const imageUrls = (raw.imageUrls || '')
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean);
    const shippingMetrics = resolveShippingMetrics({
      netWeight: raw.netWeight,
      grossWeight: raw.grossWeight,
      length: raw.length,
      width: raw.width,
      height: raw.height,
      dimensionsRaw: raw.dimensionsRaw,
      weightUnit: raw.weightUnit,
      dimensionUnit: raw.dimensionUnit,
      defaultWeightUnit: defaults.defaultWeightUnit,
      defaultDimensionUnit: defaults.defaultDimensionUnit,
    });
    const parsedOemReferences = parseCompoundOemReferences(
      raw.oemReferences || raw.oemPartNumber || '',
    );
    const oeNumbers = [
      ...parsedOemReferences.map((reference) => reference.displayNumber),
      ...extractOeNumbers(title),
    ].filter((v): v is string => Boolean(v?.trim()));
    const parsedVehicle = parseVehicleFromTitle(title);
    const category = raw.category?.trim() || extractCategory(title);
    const partClassKey = resolvePartClassKey({ title, category });
    const resolved = resolveItemWeight({
      weightKg: shippingMetrics.weightKg,
      dimensionsCm: shippingMetrics.dimensionsCm,
      weightSource: shippingMetrics.weightKg ? 'SPREADSHEET' : null,
      partClassKey,
    });
    const billable = deriveBillableWeight({
      actualKg: resolved.actualKg,
      dimensionsCm: shippingMetrics.dimensionsCm,
    });
    const existingBrandClassification = brand
      ? await this.prisma.brandMaster.findFirst({
          where: {
            canonicalName: {
              equals: normalizeMasterName(brand),
              mode: 'insensitive',
            },
          },
          select: {
            isVehicleManufacturer: true,
            isAftermarketBrand: true,
            suppliesGenuineOem: true,
          },
        })
      : null;
    const classification = classifyPart({
      declaredType:
        raw.partType || raw.__suggestedPartType || defaults.defaultPartSource,
      brand,
      condition: raw.condition,
      sourceContext:
        raw.__template === 'FEBEST_AVAILABILITY' ||
        raw.__template === 'DYNATRADE_STOCK'
          ? 'AFTERMARKET_CATALOG'
          : raw.__template === 'DXB_EXW'
            ? 'MIXED_CATALOG'
            : undefined,
      brandClassification: existingBrandClassification,
    });
    // partSource only distinguishes OEM vs AFTERMARKET provenance —
    // SALVAGE_OEM/REMANUFACTURED/REFURBISHED are still OEM-sourced parts,
    // just via a donor vehicle or a rebuild, so they stay 'OEM' here.
    const partSource =
      classification.partType === 'AFTERMARKET' ? 'AFTERMARKET' : 'OEM';
    const qualityTier = normalizeQualityTier(
      raw.condition || defaults.defaultQualityTier,
    );
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
    if (!primaryCurrency)
      reviewReasons.push('Price currency requires confirmation');
    if (raw.__template === 'FEBEST_AVAILABILITY' && !defaults.defaultWeightUnit)
      reviewReasons.push('Weight unit requires confirmation');
    if (
      raw.__template === 'FEBEST_AVAILABILITY' &&
      !defaults.defaultDimensionUnit
    )
      reviewReasons.push('Dimension unit requires confirmation');
    // Weight drives the shipping quote, so surface unit ambiguity and gaps
    // rather than letting the part fall back to a class-median estimate.
    reviewReasons.push(...shippingMetrics.warnings);
    if (!shippingMetrics.weightKg)
      reviewReasons.push(
        'Shipping weight missing — quotes will use a class estimate',
      );
    if (resolved.outlier)
      reviewReasons.push(
        `Weight ${resolved.actualKg}kg is outside the expected range for ${resolved.partClassKey}`,
      );
    if (resolved.unitAutoConverted)
      reviewReasons.push(
        `Weight unit likely wrong — auto-converted from ${shippingMetrics.weightKg} to ${resolved.actualKg}kg`,
      );
    if (classification.status !== 'READY')
      reviewReasons.push(...classification.reasons);
    for (const reference of parsedOemReferences) {
      if (reference.reviewReason)
        reviewReasons.push(`${reference.raw}: ${reference.reviewReason}`);
      if (reference.namespaceType === 'UNKNOWN' && defaults.preview) {
        const hint =
          reference.matchedAlias ||
          reference.raw.split(/\s+/)[0] ||
          reference.raw;
        if (hint && !defaults.preview.unrecognizedMakes.includes(hint)) {
          defaults.preview.unrecognizedMakes.push(hint);
        }
      }
    }
    if (classification.status !== 'READY' && defaults.preview)
      defaults.preview.ambiguousClassifications += 1;
    if (defaults.preview)
      defaults.preview.oemReferences += parsedOemReferences.length;

    const normalizedMpn = normalizePartNumber(manufacturerPartNumber);
    const brandMaster = brand
      ? await this.prisma.brandMaster.upsert({
          where: { canonicalName: normalizeMasterName(brand) },
          update: { displayName: brand },
          create: {
            canonicalName: normalizeMasterName(brand),
            displayName: brand,
            brandTypes:
              classification.partType === 'AFTERMARKET' ? ['AFTERMARKET'] : [],
            isAftermarketBrand: classification.partType === 'AFTERMARKET',
            requiresManualReview: classification.status !== 'READY',
          },
        })
      : null;

    const matchCandidates = await this.catalogMatch.findCandidates({
      brandId: brandMaster?.id,
      brandName: brand,
      manufacturerPartNumber,
      oemNumbers: parsedOemReferences.map((r) => r.normalizedNumber),
    });
    const autoMatch = this.catalogMatch.pickAutoMatch(matchCandidates);
    if (defaults.preview) {
      if (autoMatch) defaults.preview.productsMatch += 1;
      else defaults.preview.productsCreate += 1;
      defaults.preview.offersUpsert += 1;
    }

    const stagedPayload = {
      title,
      brand,
      manufacturerPartNumber,
      normalizedMpn,
      description,
      category,
      classification,
      partSource,
      qualityTier,
      primaryCurrency,
      price,
      quantity,
      stockSharjah,
      stockJebelAli,
      imageUrls,
      parsedOemReferences,
      parsedVehicle,
      matchCandidates,
      autoMatchPartId: autoMatch?.canonicalPartId || null,
      weightKg: resolved.actualKg,
      weightConfidence: shippingMetrics.weightConfidence,
      dimensionsCm: shippingMetrics.dimensionsCm,
      dimensionsConfidence: shippingMetrics.dimensionsConfidence,
      partClassKey,
      dimensionalWeightKg: billable?.volumetricKg ?? null,
      billableWeightKg: billable?.billableKg ?? null,
      weightOutlier: resolved.outlier,
      weightUnitAutoConverted: resolved.unitAutoConverted,
    };

    if (defaults.commitMode === 'STAGED') {
      const status = reviewReasons.length > 0 ? 'NEEDS_REVIEW' : 'STAGED';
      await this.createUploadRow(
        uploadJobId,
        row,
        status,
        reviewReasons,
        {
          title,
          brand: brand || null,
          category,
          oemPartNumber: oeNumbers[0],
          partSource,
          qualityTier,
          condition: qualityTier,
          price: Number.isFinite(price) ? price : undefined,
          quantity: Math.max(0, Number.isFinite(quantity) ? quantity : 0),
          currency: primaryCurrency || 'USD',
          imageUrls,
          fitmentSummary: parsedVehicle,
          sourceKey: deterministicSourceKey(
            'SPREADSHEET_ROW',
            sellerId,
            defaults.fileChecksum,
            row.sheetName,
            row.rowNumber,
          ),
          normalizedData: {
            normalizedMpn,
            parsedOemReferences,
            classification,
          },
          stagedPayload,
          suggestedPartType: classification.partType,
          classificationConfidence: classification.confidence,
          classificationReason: classification.reasons.join('; '),
          matchConfidence: autoMatch?.score ?? matchCandidates[0]?.score ?? 0,
          matchCandidateId:
            autoMatch?.canonicalPartId || matchCandidates[0]?.canonicalPartId,
          matchExplanation: { candidates: matchCandidates },
        },
        defaults.existingRowId,
      );

      if (
        classification.status === 'ACTION_REQUIRED' ||
        classification.status === 'REVIEW_RECOMMENDED'
      ) {
        await this.reviewTasks.enqueue({
          queueType: 'CLASSIFICATION',
          title: `Classify ${manufacturerPartNumber}`,
          description: classification.reasons.join('; '),
          severity:
            classification.status === 'ACTION_REQUIRED' ? 'HIGH' : 'MEDIUM',
          sellerId,
          uploadJobId,
          entityType: 'SellerUploadRow',
          confidence: classification.confidence,
          payload: { brand, manufacturerPartNumber, classification },
        });
      }
      for (const reference of parsedOemReferences.filter(
        (r) => r.reviewReason,
      )) {
        await this.reviewTasks.enqueue({
          queueType: 'OEM_PARSE',
          title: `Unrecognized OEM token on ${manufacturerPartNumber}`,
          description: reference.reviewReason || reference.raw,
          severity: 'MEDIUM',
          sellerId,
          uploadJobId,
          entityType: 'SellerUploadRow',
          payload: { reference },
        });
      }
      await this.audit.record({
        action: 'IMPORT_STAGE',
        entityType: 'SellerUploadJob',
        entityId: uploadJobId,
        actorType: 'SYSTEM',
        reason: status,
        confidence: classification.confidence,
        originalValue: row.original || raw,
        normalizedValue: stagedPayload,
      });
      return {
        status,
        message: reviewReasons.join('; '),
        needsReview: reviewReasons.length > 0,
      };
    }

    const status = reviewReasons.length > 0 ? 'NEEDS_REVIEW' : 'IMPORTED';
    const existingNumber = autoMatch
      ? await this.prisma.catalogPartNumber.findFirst({
          where: {
            canonicalPartId: autoMatch.canonicalPartId,
            numberType: 'BRAND_MPN',
            normalizedNumber: normalizedMpn,
          },
          include: { canonicalPart: true },
        })
      : await this.prisma.catalogPartNumber.findFirst({
          where: {
            normalizedNumber: normalizedMpn,
            numberType: 'BRAND_MPN',
            brandId: brandMaster?.id ?? null,
          },
          include: { canonicalPart: true },
        });
    const canonicalPart =
      existingNumber?.canonicalPart ??
      (await this.prisma.canonicalPart.create({
        data: {
          title,
          normalizedTitle: title
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, ' ')
            .trim(),
          description: description || null,
          brand: brand || null,
          manufacturer: brand || null,
          primaryBrandId: brandMaster?.id,
          manufacturerPartNumber,
          category,
          oeNumbers: Array.from(new Set(oeNumbers.map((v) => v.toUpperCase()))),
          fitmentFlags: reviewReasons,
          imageUrls,
          weight: resolved.actualKg,
          weightSource: resolved.source,
          weightConfidence: shippingMetrics.weightConfidence ?? undefined,
          dimensions: (shippingMetrics.dimensionsCm as any) ?? undefined,
          partClassKey,
          dimensionalWeightKg: billable?.volumetricKg ?? undefined,
          billableWeightKg: billable?.billableKg ?? undefined,
          compatibility: parsedVehicle
            ? ({ source: 'title_parse', vehicle: parsedVehicle } as any)
            : undefined,
          partSource,
          partType: partTypeFromLegacy(partSource, classification.partType),
          classificationStatus: classification.status,
          classificationConfidence: classification.confidence,
          classificationReason: classification.reasons.join('; '),
          qualityTier,
          fitmentStatus: parsedVehicle
            ? status === 'IMPORTED'
              ? 'AUTO_MATCHED'
              : 'NEEDS_REVIEW'
            : 'NEEDS_REVIEW',
          fitmentConfidence: parsedVehicle ? 0.5 : 0,
        },
      }));

    if (existingNumber?.canonicalPart) {
      await this.backfillShippingMetrics(existingNumber.canonicalPart, {
        weightKg: shippingMetrics.weightKg,
        weightConfidence: shippingMetrics.weightConfidence,
        dimensionsCm: shippingMetrics.dimensionsCm,
        partClassKey,
      });
    }

    await this.audit.record({
      action: existingNumber ? 'MATCH' : 'CLASSIFY',
      entityType: 'CanonicalPart',
      entityId: canonicalPart.id,
      actorType: 'SYSTEM',
      source: 'SELLER_SPREADSHEET',
      reason: classification.reasons.join('; '),
      confidence: classification.confidence,
      originalValue: { brand, manufacturerPartNumber },
      normalizedValue: { partType: classification.partType, normalizedMpn },
      canonicalPartId: canonicalPart.id,
      metadata: { matchCandidates, autoMatch },
    });

    const existingMpn = await this.prisma.catalogPartNumber.findFirst({
      where: {
        canonicalPartId: canonicalPart.id,
        numberType: 'BRAND_MPN',
        normalizedNumber: normalizedMpn,
        brandId: brandMaster?.id ?? null,
        vehicleMakeId: null,
      },
    });
    if (existingMpn)
      await this.prisma.catalogPartNumber.update({
        where: { id: existingMpn.id },
        data: { displayNumber: manufacturerPartNumber },
      });
    else
      await this.prisma.catalogPartNumber.create({
        data: {
          canonicalPartId: canonicalPart.id,
          displayNumber: manufacturerPartNumber,
          normalizedNumber: normalizedMpn,
          numberType: 'BRAND_MPN',
          brandId: brandMaster?.id,
          source: 'SELLER_SPREADSHEET',
          verificationStatus:
            raw.__template === 'FEBEST_AVAILABILITY'
              ? 'SELLER_DECLARED'
              : 'UNVERIFIED',
          confidence: raw.__template === 'FEBEST_AVAILABILITY' ? 0.96 : 0.55,
        },
      });

    for (const reference of parsedOemReferences) {
      const make = reference.canonicalMake
        ? await this.prisma.vehicleMake.upsert({
            where: { name: reference.canonicalMake },
            update: {},
            create: {
              name: reference.canonicalMake,
              canonicalName: reference.canonicalMake,
              displayName: reference.canonicalMake,
            },
          })
        : null;
      const existingReference = await this.prisma.catalogPartNumber.findFirst({
        where: {
          canonicalPartId: canonicalPart.id,
          numberType: 'OEM_CROSS_REFERENCE',
          normalizedNumber: reference.normalizedNumber,
          brandId: null,
          vehicleMakeId: make?.id ?? null,
        },
      });
      if (existingReference)
        await this.prisma.catalogPartNumber.update({
          where: { id: existingReference.id },
          data: {
            displayNumber: reference.displayNumber,
            confidence: reference.confidence,
          },
        });
      else
        await this.prisma.catalogPartNumber.create({
          data: {
            canonicalPartId: canonicalPart.id,
            displayNumber: reference.displayNumber,
            normalizedNumber: reference.normalizedNumber,
            numberType: 'OEM_CROSS_REFERENCE',
            vehicleMakeId: make?.id,
            source: 'SELLER_SPREADSHEET',
            verificationStatus: 'SELLER_DECLARED',
            confidence: reference.confidence,
            metadata: {
              raw: reference.raw,
              namespaceType: reference.namespaceType,
            },
          },
        });
    }

    const rawFilePrice = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0;
    const priceQuote = await this.pricing.quote(
      sellerId,
      category,
      rawFilePrice,
    );
    const offerSourceKey = deterministicSourceKey(
      'SPREADSHEET',
      sellerId,
      defaults.fileChecksum,
      row.sheetName,
      row.rowNumber,
    );
    // Listing price is ALWAYS filePrice / margin divisor (default 0.7).
    // This is enforced regardless of any pricing policy to maintain consistent margins.
    const listingPrice = Number.isFinite(price) && price > 0 ? price : 0;
    const marketplaceFee = Math.round((listingPrice - rawFilePrice) * 100) / 100;
    const offerData = {
      sellerId,
      canonicalPartId: canonicalPart.id,
      price: listingPrice,
      sellerBasePrice: rawFilePrice,
      marketplaceFee: marketplaceFee,
      sellerProceeds: rawFilePrice,
      pricingPolicyId: priceQuote.pricingPolicyId,
      pricingPolicyVersion: priceQuote.pricingPolicyVersion,
      pricedAt: new Date(),
      currency: priceQuote.pricingPolicyId
        ? priceQuote.currency
        : primaryCurrency || 'USD',
      condition: qualityTier,
      partSource,
      partType: classification.partType,
      qualityTier,
      sellerSku:
        raw.sku?.trim() || raw.sourceCode?.trim() || manufacturerPartNumber,
      sellerTitle: title,
      moq: raw.moq ? Math.max(1, parseInt(raw.moq, 10) || 1) : 1,
      externalOfferId: raw.sku?.trim() || manufacturerPartNumber,
      sourceKey: offerSourceKey,
      sourceTag: tagFromTemplate(raw.__template as ImportTemplate),
      status:
        quantity === 0
          ? 'OUT_OF_STOCK'
          : sellerStatus === 'ACTIVE'
            ? 'ACTIVE'
            : 'REVIEW',
    };
    const existingOffer = await this.prisma.sellerOffer.findUnique({
      where: { sourceKey: offerSourceKey },
    });
    const offer = existingOffer
      ? await this.prisma.sellerOffer.update({
          where: { id: existingOffer.id },
          data: offerData,
        })
      : await this.prisma.sellerOffer.create({ data: offerData });

    const inventoryRows: Array<{ warehouseId: string; quantity: number }> = [];
    if (stockSharjah !== null || stockJebelAli !== null) {
      const sharjah = await this.findOrCreateWarehouse(
        sellerId,
        'SHARJAH',
        'Sharjah',
      );
      const jebelAli = await this.findOrCreateWarehouse(
        sellerId,
        'JEBEL_ALI',
        'Jebel Ali',
      );
      inventoryRows.push({
        warehouseId: sharjah.id,
        quantity: Math.max(0, stockSharjah ?? 0),
      });
      inventoryRows.push({
        warehouseId: jebelAli.id,
        quantity: Math.max(0, stockJebelAli ?? 0),
      });
    } else {
      inventoryRows.push({
        warehouseId,
        quantity: Math.max(0, Number.isFinite(quantity) ? quantity : 0),
      });
    }
    for (const inventory of inventoryRows) {
      await this.prisma.inventory.upsert({
        where: {
          warehouseId_offerId: {
            warehouseId: inventory.warehouseId,
            offerId: offer.id,
          },
        },
        update: {
          quantity: inventory.quantity,
          status: inventory.quantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
        },
        create: {
          ...inventory,
          offerId: offer.id,
          status: inventory.quantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
        },
      });
    }

    const sourceKey = deterministicSourceKey(
      'SPREADSHEET_ROW',
      sellerId,
      defaults.fileChecksum,
      row.sheetName,
      row.rowNumber,
    );
    await this.prisma.sourceRecord.upsert({
      where: { sourceKey },
      update: {
        canonicalPartId: canonicalPart.id,
        sellerOfferId: offer.id,
        rawPayload: row.original || raw,
        transformations: {
          template: raw.__template,
          normalizedMpn,
          parsedOemReferences,
          classification,
          matchCandidates,
        } as any,
        classificationConfidence: classification.confidence,
        matchConfidence: autoMatch?.score ?? 0,
        lastSyncedAt: new Date(),
      },
      create: {
        sourceType: 'SPREADSHEET_ROW',
        sourcePlatform: 'SELLER_UPLOAD',
        sellerId,
        canonicalPartId: canonicalPart.id,
        sellerOfferId: offer.id,
        sourceFileName: defaults.fileName,
        sourceSheet: row.sheetName,
        sourceRowNumber: row.rowNumber,
        sourceKey,
        rawPayload: row.original || raw,
        transformations: {
          template: raw.__template,
          normalizedMpn,
          parsedOemReferences,
          classification,
          matchCandidates,
        } as any,
        classificationConfidence: classification.confidence,
        matchConfidence: autoMatch?.score ?? 0,
      },
    });

    for (const [currency, amountText] of [
      ['USD', raw.priceUsd],
      ['AED', raw.priceAed],
    ] as const) {
      if (!amountText) continue;
      const amount = Number(amountText.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      await this.prisma.offerPrice.upsert({
        where: { offerId_currency: { offerId: offer.id, currency } },
        update: {
          amount,
          isPrimary: currency === primaryCurrency,
          exchangeRate:
            raw.priceUsd && raw.priceAed
              ? Number(raw.priceAed) / Number(raw.priceUsd)
              : undefined,
          rateSource: 'SELLER_SPREADSHEET',
        },
        create: {
          offerId: offer.id,
          currency,
          amount,
          isPrimary: currency === primaryCurrency,
          exchangeRate:
            raw.priceUsd && raw.priceAed
              ? Number(raw.priceAed) / Number(raw.priceUsd)
              : undefined,
          rateSource: 'SELLER_SPREADSHEET',
        },
      });
    }

    const fitments = parsedVehicle
      ? [
          {
            vehicleConfigId: (
              await this.findOrCreateVehicleConfig(parsedVehicle)
            ).id,
            evidenceLevel: 'D',
            confidence: 0.5,
          },
        ]
      : [];

    if (parsedVehicle && fitments[0]) {
      const fitment = await this.prisma.fitment.upsert({
        where: {
          canonicalPartId_vehicleConfigId: {
            canonicalPartId: canonicalPart.id,
            vehicleConfigId: fitments[0].vehicleConfigId,
          },
        },
        update: {
          source: 'TITLE_PARSE',
          reason: 'Inferred from listing/product title',
        },
        create: {
          canonicalPartId: canonicalPart.id,
          vehicleConfigId: fitments[0].vehicleConfigId,
          evidenceLevel: 'D',
          confidence: 0.5,
          reviewer: 'Seller upload auto-match',
          source: 'TITLE_PARSE',
          verificationStatus: 'UNVERIFIED',
          reason: 'Inferred from listing/product title',
        },
      });
      await this.prisma.fitmentEvidence
        .create({
          data: {
            fitmentId: fitment.id,
            evidenceType: 'TITLE_PARSE',
            evidenceLevel: 'D',
            confidence: 0.5,
            source: 'SELLER_SPREADSHEET',
            reason: 'Title-parsed vehicle attributes are not verified fitment',
            originalValue: parsedVehicle as any,
          },
        })
        .catch(() => undefined);
    }

    await this.search.indexPart({
      id: canonicalPart.id,
      title: canonicalPart.title,
      partType: canonicalPart.partType,
      brand: canonicalPart.brand,
      manufacturerPartNumber: canonicalPart.manufacturerPartNumber,
      partNumbers: [
        {
          displayNumber: manufacturerPartNumber,
          normalizedNumber: normalizedMpn,
          numberType: 'BRAND_MPN',
          brand,
        },
        ...parsedOemReferences.map((reference) => ({
          displayNumber: reference.displayNumber,
          normalizedNumber: reference.normalizedNumber,
          numberType: 'OEM_CROSS_REFERENCE',
          make: reference.canonicalMake,
        })),
      ],
      category: canonicalPart.category,
      oeNumbers: canonicalPart.oeNumbers,
      imageUrls: canonicalPart.imageUrls,
      compatibility: canonicalPart.compatibility,
      makes: [...new Set(
        [
          ...(Array.isArray(canonicalPart.compatibility)
            ? (canonicalPart.compatibility as any[]).map((c: any) => c.make).filter(Boolean)
            : []),
          parsedVehicle?.make,
          ...parsedOemReferences.map((r) => r.canonicalMake).filter(Boolean),
        ].filter(Boolean) as string[],
      )],
      partSource: canonicalPart.partSource,
      qualityTier: canonicalPart.qualityTier,
      fitmentStatus: canonicalPart.fitmentStatus,
      fitmentConfidence: canonicalPart.fitmentConfidence,
      createdAt: canonicalPart.createdAt,
      fitments,
      offers: [
        {
          id: offer.id,
          price: offer.price,
          condition: offer.condition,
          partSource: offer.partSource,
          qualityTier: offer.qualityTier,
          sellerId: offer.sellerId,
          sellerName,
          sourceTag: offer.sourceTag,
        },
      ],
    });

    // Durable v2-index producer: the outbox runner actually processes this
    // row (claim → index → DONE-only-on-success), unlike the immediate
    // `this.search.indexPart` call above which is best-effort and swallows
    // failures. Do not mark this DONE here — that was the bug (brief §19
    // / docs/SEARCH_PHASE1_AUDIT.md §4 RC-7): it faked completion without
    // the v2 index ever being written.
    await this.searchOutbox.enqueue(canonicalPart.id, 'UPSERT', 'SELLER_UPLOAD');

    if (classification.status !== 'READY') {
      await this.reviewTasks.enqueue({
        queueType:
          classification.partType === 'GENUINE_OEM'
            ? 'OEM_AUTHENTICITY'
            : 'CLASSIFICATION',
        title: `Review classification for ${canonicalPart.title}`,
        description: classification.reasons.join('; '),
        severity:
          classification.status === 'ACTION_REQUIRED' ? 'HIGH' : 'MEDIUM',
        sellerId,
        uploadJobId,
        canonicalPartId: canonicalPart.id,
        entityType: 'CanonicalPart',
        entityId: canonicalPart.id,
        confidence: classification.confidence,
        payload: { classification, brand, manufacturerPartNumber },
      });
    }

    await this.createUploadRow(
      uploadJobId,
      row,
      status,
      reviewReasons,
      {
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
        stagedPayload,
        suggestedPartType: classification.partType,
        classificationConfidence: classification.confidence,
        classificationReason: classification.reasons.join('; '),
        matchConfidence: autoMatch?.score ?? (existingNumber ? 1 : 0),
        matchCandidateId: canonicalPart.id,
        matchExplanation: { candidates: matchCandidates },
      },
      defaults.existingRowId,
    );

    return {
      status,
      message: reviewReasons.join('; '),
      needsReview: reviewReasons.length > 0,
    };
  }

  /**
   * Reprice all existing offers for a seller so that listingPrice = filePrice / 0.7.
   *
   * Uses the OfferPrice table (which stores the original file prices) to recalculate
   * the listing price with the correct margin. This fixes discrepancies where pricing
   * policies may have inflated prices beyond the intended 30% margin.
   */
  async repriceFromFilePrices(sellerId: string) {
    const MARGIN_DIVISOR = Number(process.env.PRICE_MARGIN_DIVISOR || '0.7');
    if (MARGIN_DIVISOR <= 0 || MARGIN_DIVISOR >= 1) {
      throw new BadRequestException(
        'PRICE_MARGIN_DIVISOR must be between 0 and 1 (exclusive)',
      );
    }

    const offers = await this.prisma.sellerOffer.findMany({
      where: { sellerId },
      include: { prices: true },
    });

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const offer of offers) {
      // Primary source: OfferPrice (original file price).
      // Fallback: sellerBasePrice (already corrected to filePrice after backfill).
      const primaryPrice =
        offer.prices.find((p) => p.isPrimary) || offer.prices[0];
      const rawFilePrice = primaryPrice
        ? Number(primaryPrice.amount)
        : offer.sellerBasePrice ?? 0;
      if (!Number.isFinite(rawFilePrice) || rawFilePrice <= 0) {
        skipped++;
        continue;
      }

      const listingPrice =
        Math.round((rawFilePrice / MARGIN_DIVISOR) * 100) / 100;
      const marketplaceFee =
        Math.round((listingPrice - rawFilePrice) * 100) / 100;

      // Only update if the price actually differs (avoid unnecessary writes).
      const priceDiffers =
        Math.abs(offer.price - listingPrice) > 0.01 ||
        Math.abs((offer.sellerBasePrice ?? 0) - rawFilePrice) > 0.01;
      if (!priceDiffers) {
        skipped++;
        continue;
      }

      try {
        await this.prisma.sellerOffer.update({
          where: { id: offer.id },
          data: {
            price: listingPrice,
            sellerBasePrice: rawFilePrice,
            marketplaceFee,
            sellerProceeds: rawFilePrice,
            pricedAt: new Date(),
          },
        });
        updated++;
      } catch (err) {
        errors.push(`Offer ${offer.id}: ${(err as Error).message}`);
      }
    }

    return { updated, skipped, errors, total: offers.length };
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
    if (!Number.isFinite(input.price) || input.price <= 0)
      reasons.push('Missing or invalid price');
    if (!Number.isFinite(input.quantity) || input.quantity < 0)
      reasons.push('Missing or invalid quantity');
    if (input.imageUrls.length === 0) reasons.push('Missing product images');
    if (input.oeNumbers.length === 0)
      reasons.push('Missing OE/OEM or manufacturer part number');
    if (!input.parsedVehicle)
      reasons.push('Vehicle compatibility could not be inferred');
    if (input.partSource === 'AFTERMARKET' && !input.brand?.trim())
      reasons.push('Aftermarket part needs brand/manufacturer');
    return reasons;
  }

  /**
   * Fills shipping metrics on a part matched to an existing catalog record.
   *
   * Only null fields are written. A later upload must never overwrite a weight
   * that already came from a measurement or a higher-confidence source, since
   * that value is already being quoted against.
   */
  private async backfillShippingMetrics(
    part: {
      id: string;
      weight: number | null;
      weightConfidence: number | null;
      dimensions: unknown;
      partClassKey: string | null;
    },
    incoming: {
      weightKg: number | null;
      weightConfidence: number | null;
      dimensionsCm: { lengthCm: number; widthCm: number; heightCm: number } | null;
      partClassKey: string;
    },
  ) {
    const data: Record<string, unknown> = {};

    if (part.weight === null && incoming.weightKg !== null) {
      data.weight = incoming.weightKg;
      data.weightSource = 'SPREADSHEET';
      data.weightConfidence = incoming.weightConfidence;
    }

    const existingDims = parseDimensionsJson(part.dimensions);
    if (!existingDims && incoming.dimensionsCm) {
      data.dimensions = incoming.dimensionsCm;
    }

    if (!part.partClassKey) data.partClassKey = incoming.partClassKey;

    if (Object.keys(data).length === 0) return;

    const effectivePartClassKey =
      (data.partClassKey as string) ?? part.partClassKey ?? incoming.partClassKey;
    const effectiveWeight = (data.weight as number) ?? part.weight ?? null;
    const effectiveDims =
      (data.dimensions as typeof incoming.dimensionsCm | undefined) ??
      existingDims ??
      null;

    const resolved = resolveItemWeight({
      weightKg: effectiveWeight,
      dimensionsCm: effectiveDims,
      weightSource: effectiveWeight ? 'SPREADSHEET' : null,
      partClassKey: effectivePartClassKey,
    });

    if (resolved.unitAutoConverted && effectiveWeight) {
      data.weight = resolved.actualKg;
    }

    const billable = deriveBillableWeight({
      actualKg: resolved.actualKg,
      dimensionsCm: effectiveDims,
    });
    if (billable) {
      data.dimensionalWeightKg = billable.volumetricKg;
      data.billableWeightKg = billable.billableKg;
    }

    await this.prisma.canonicalPart.update({
      where: { id: part.id },
      data: data as any,
    });
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
      stagedPayload: unknown;
      suggestedPartType: string;
      classificationConfidence: number;
      classificationReason: string;
      matchConfidence: number;
      matchCandidateId: string;
      matchExplanation: unknown;
    }> = {},
    existingRowId?: string,
  ) {
    const data = {
      uploadJobId,
      rowNumber: row.rowNumber,
      status,
      sku: row.raw.sku || null,
      title: extra.title || row.raw.title || null,
      brand: extra.brand || row.raw.brand || null,
      category: extra.category || row.raw.category || null,
      oemPartNumber:
        extra.oemPartNumber || row.raw.oemPartNumber || row.raw.mpn || null,
      partSource: extra.partSource || 'OEM',
      qualityTier: extra.qualityTier || 'USED',
      condition: extra.condition || 'USED',
      price: extra.price,
      quantity: extra.quantity ?? 1,
      currency: extra.currency || row.raw.currency || 'AED',
      imageUrls: extra.imageUrls || [],
      fitmentSummary:
        extra.fitmentSummary === undefined
          ? undefined
          : (extra.fitmentSummary as any),
      reviewReasons,
      message: reviewReasons.join('; ') || null,
      rawData: row.original || row.raw,
      sourceKey: extra.sourceKey,
      normalizedData:
        extra.normalizedData === undefined
          ? undefined
          : (extra.normalizedData as any),
      stagedPayload:
        extra.stagedPayload === undefined
          ? undefined
          : (extra.stagedPayload as any),
      suggestedPartType: extra.suggestedPartType,
      classificationConfidence: extra.classificationConfidence,
      classificationReason: extra.classificationReason,
      matchConfidence: extra.matchConfidence,
      matchCandidateId: extra.matchCandidateId,
      matchExplanation:
        extra.matchExplanation === undefined
          ? undefined
          : (extra.matchExplanation as any),
      canonicalPartId: extra.canonicalPartId,
      sellerOfferId: extra.sellerOfferId,
    };

    if (existingRowId) {
      return this.prisma.sellerUploadRow.update({
        where: { id: existingRowId },
        data,
      });
    }

    const existing = await this.prisma.sellerUploadRow.findUnique({
      where: {
        uploadJobId_rowNumber: { uploadJobId, rowNumber: row.rowNumber },
      },
    });
    if (existing) {
      return this.prisma.sellerUploadRow.update({
        where: { id: existing.id },
        data,
      });
    }

    return this.prisma.sellerUploadRow.create({ data });
  }

  async reviewRow(
    rowId: string,
    body: { status: string; offerStatus?: string; notes?: string },
  ) {
    const row = await this.prisma.sellerUploadRow.findUnique({
      where: { id: rowId },
    });
    if (!row) throw new NotFoundException('Upload row not found');

    if (row.sellerOfferId && body.offerStatus) {
      if (body.offerStatus === 'ACTIVE') {
        const offer = await this.prisma.sellerOffer.findUnique({
          where: { id: row.sellerOfferId },
          include: { seller: true },
        });
        if (offer?.seller.onboardingStatus !== 'ACTIVE') {
          throw new BadRequestException(
            'Seller must be ACTIVE before an offer can be activated',
          );
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
        reviewReasons:
          body.status === 'APPROVED'
            ? []
            : Array.isArray(row.reviewReasons)
              ? row.reviewReasons
              : [],
      },
    });
  }

  private async findOrCreateWarehouse(
    sellerId: string,
    externalKey: string,
    name: string,
  ) {
    const existing = await this.prisma.warehouse.findFirst({
      where: { sellerId, externalKey },
    });
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
          name:
            vehicle.startYear === vehicle.endYear
              ? `${vehicle.startYear}`
              : `${vehicle.startYear}-${vehicle.endYear}`,
          startYear: vehicle.startYear,
          endYear: vehicle.endYear,
        },
      });
    }

    // QA-03: single canonical config per vehicle identity (race-safe).
    return resolveVehicleConfiguration(this.prisma, {
      generationId: generation.id,
      market: 'GLOBAL',
    });
  }
}
