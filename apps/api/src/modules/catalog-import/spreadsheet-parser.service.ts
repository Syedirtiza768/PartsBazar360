import { BadRequestException, Injectable } from '@nestjs/common';
import { Workbook, type CellValue } from 'exceljs';

export type ImportTemplate = 'DXB_EXW' | 'FEBEST_AVAILABILITY' | 'DYNATRADE_STOCK' | 'GENERIC';

export interface ParsedWorkbookRow {
  rowNumber: number;
  sheetName: string;
  raw: Record<string, string>;
  original: Record<string, string>;
}

export interface ParsedWorkbook {
  template: ImportTemplate;
  sheetName: string;
  headers: string[];
  rows: ParsedWorkbookRow[];
  suggestedDefaults: Record<string, string>;
}

const FIELD_ALIASES: Record<string, string> = {
  title: 'title', name: 'title', description: 'description', partdescription: 'description',
  code: 'sourceCode', sku: 'sku', customlabel: 'sku', customlabelsku: 'sku',
  brand: 'brand', brandcode: 'brand',
  reference: 'manufacturerPartNumber', partnumber: 'manufacturerPartNumber',
  manufacturerpartnumber: 'manufacturerPartNumber', mpn: 'manufacturerPartNumber',
  manufacturerno: 'manufacturerPartNumber', manufacturernumber: 'manufacturerPartNumber',
  oem: 'oemReferences', oempartnumber: 'oemReferences', oeoempartnumber: 'oemReferences',
  originalpartno: 'oemReferences', originalpartnumber: 'oemReferences',
  quantity: 'quantity', qty: 'quantity', stock: 'quantity', moq: 'moq',
  price: 'price', priceusd: 'priceUsd', priceaed: 'priceAed', currency: 'currency',
  unitprice: 'price',
  stocksharjah: 'stockSharjah', stockjebelali: 'stockJebelAli',
  netweight: 'netWeight', grossweight: 'grossWeight',
  height: 'height', length: 'length', width: 'width',
  condition: 'condition', conditionid: 'condition', parttype: 'partType', category: 'category',
  imageurl: 'imageUrls', imageurls: 'imageUrls', images: 'imageUrls', picurl: 'imageUrls',
};

function headerKey(value: string) {
  return value.toLowerCase().replace(/^\*/, '').replace(/[^a-z0-9]/g, '');
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined && value.result !== null) {
      const result = String(value.result).trim();
      if (result && !result.startsWith('#')) return result;
    }
    if ('text' in value && typeof value.text === 'string') {
      const text = value.text.trim();
      if (text && !text.startsWith('#')) return text;
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
  }
  return String(value).trim();
}

function detectTemplate(headers: string[]): ImportTemplate {
  const keys = new Set(headers.map(headerKey).filter(Boolean));
  if (keys.has('reference') && keys.has('stocksharjah') && keys.has('stockjebelali') && keys.has('oem')) {
    return 'FEBEST_AVAILABILITY';
  }
  if (keys.has('code') && keys.has('brand') && keys.has('partnumber') && keys.has('priceusd') && keys.has('priceaed')) {
    return 'DXB_EXW';
  }
  // Dynatrade: Original Part No. + Manufacturer No. + Part Description + STOCK + UNIT PRICE
  // Brand text often lives in an unlabeled column beside a broken BRAND VLOOKUP.
  if (
    (keys.has('originalpartno') || keys.has('originalpartnumber'))
    && (keys.has('manufacturerno') || keys.has('manufacturernumber'))
    && keys.has('partdescription')
    && keys.has('stock')
    && keys.has('unitprice')
  ) {
    return 'DYNATRADE_STOCK';
  }
  return 'GENERIC';
}

function suggestedDefaultsFor(template: ImportTemplate): Record<string, string> {
  if (template === 'FEBEST_AVAILABILITY') return { partType: 'AFTERMARKET', brand: 'FEBEST' };
  if (template === 'DXB_EXW') return { partType: 'MIXED' };
  if (template === 'DYNATRADE_STOCK') return { partType: 'AFTERMARKET', currency: 'AED' };
  return {};
}

@Injectable()
export class SpreadsheetParserService {
  async parse(fileName: string, buffer: Buffer): Promise<ParsedWorkbook[]> {
    const workbook = new Workbook();
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.xlsx')) {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } else if (lower.endsWith('.csv')) {
      await workbook.csv.read(buffer as any);
    } else {
      throw new BadRequestException('Only .xlsx and .csv seller files are supported');
    }

    const parsed: ParsedWorkbook[] = [];
    for (const sheet of workbook.worksheets) {
      if (sheet.actualRowCount < 2) continue;
      let headerRowNumber = 1;
      let bestScore = -1;
      for (let rowNumber = 1; rowNumber <= Math.min(20, sheet.actualRowCount); rowNumber++) {
        const values = (sheet.getRow(rowNumber).values as CellValue[]).slice(1).map(cellText);
        const score = values.filter(Boolean).length + values.filter((value) => FIELD_ALIASES[headerKey(value)]).length * 3;
        if (score > bestScore) { bestScore = score; headerRowNumber = rowNumber; }
      }

      const headers = (sheet.getRow(headerRowNumber).values as CellValue[]).slice(1).map(cellText);
      const template = detectTemplate(headers);
      const rows: ParsedWorkbookRow[] = [];
      for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.actualRowCount; rowNumber++) {
        const values = (sheet.getRow(rowNumber).values as CellValue[]).slice(1).map(cellText);
        if (!values.some(Boolean)) continue;
        const raw: Record<string, string> = {};
        const original: Record<string, string> = {};
        headers.forEach((header, index) => {
          const value = values[index] ?? '';
          const originalKey = header || `column_${index + 1}`;
          original[originalKey] = value;
          const mapped = FIELD_ALIASES[headerKey(header)];
          if (mapped) {
            // Dynatrade BRAND column is often a broken VLOOKUP (#ERROR!) — prefer brand code column.
            if (mapped === 'brand' && template === 'DYNATRADE_STOCK' && (!value || value.startsWith('#'))) {
              return;
            }
            raw[mapped] = value;
            return;
          }
          // Unlabeled column immediately after BRAND holds Dynatrade brand codes (ANC, AE, BHR, …).
          if (template === 'DYNATRADE_STOCK' && !header && index > 0 && headerKey(headers[index - 1] || '') === 'brand') {
            if (value) raw.brand = value;
          }
        });
        rows.push({ rowNumber, sheetName: sheet.name, raw, original });
      }

      parsed.push({
        template,
        sheetName: sheet.name,
        headers,
        rows,
        suggestedDefaults: suggestedDefaultsFor(template),
      });
    }
    if (parsed.length === 0) throw new BadRequestException('Workbook contains no non-empty data sheets');
    return parsed;
  }
}
