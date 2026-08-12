/**
 * Reads eBay Seller Hub "Active listings" exports (.xlsx or .csv), keyed by
 * the "Item number" column (the real eBay item id). Shared by the
 * reconcile-active-listings and backfill-targeted-listings CLIs.
 */
import ExcelJS from 'exceljs';

export function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value !== null) {
    const v: any = value;
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return cellText(v.text);
    if (Array.isArray(v.richText)) {
      return v.richText.map((r: any) => r.text).join('');
    }
  }
  return String(value).trim();
}

async function readActiveItemNumbersFromCsv(
  filePath: string,
): Promise<Map<string, string>> {
  console.log(`  opening ${filePath} (csv)...`);
  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.readFile(filePath);

  const headerRow = sheet.getRow(1);
  const colIndex: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    const header = cellText(cell.value);
    if (header) colIndex[header] = colNumber;
  });
  const itemCol = colIndex['Item number'];
  if (!itemCol) {
    throw new Error(`"Item number" column not found in ${filePath}`);
  }
  const skuCol = colIndex['Custom label (SKU)'];

  const result = new Map<string, string>();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const itemNumber = cellText(row.getCell(itemCol).value);
    if (!itemNumber) return;
    const sku = skuCol ? cellText(row.getCell(skuCol).value) : '';
    result.set(itemNumber, sku);
  });
  console.log(`  finished reading ${filePath}: ${result.size} item numbers.`);
  return result;
}

async function readActiveItemNumbersFromXlsx(
  filePath: string,
): Promise<Map<string, string>> {
  console.log(`  opening ${filePath} (streaming)...`);
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  });

  const result = new Map<string, string>();
  const colIndex: Record<string, number> = {};
  let itemCol: number | undefined;
  let skuCol: number | undefined;
  let rowCount = 0;

  for await (const worksheetReader of workbookReader) {
    for await (const row of worksheetReader) {
      rowCount++;
      if (row.number === 1) {
        row.eachCell((cell, colNumber) => {
          const header = cellText(cell.value);
          if (header) colIndex[header] = colNumber;
        });
        itemCol = colIndex['Item number'];
        skuCol = colIndex['Custom label (SKU)'];
        if (!itemCol) {
          throw new Error(`"Item number" column not found in ${filePath}`);
        }
        continue;
      }
      const itemNumber = cellText(row.getCell(itemCol!).value);
      if (!itemNumber) continue;
      const sku = skuCol ? cellText(row.getCell(skuCol).value) : '';
      result.set(itemNumber, sku);
      if (rowCount % 20000 === 0) {
        console.log(`  ... read ${rowCount} rows`);
      }
    }
    break; // only the first worksheet
  }
  console.log(`  finished reading ${filePath}: ${result.size} item numbers.`);
  return result;
}

/** Maps "Item number" -> "Custom label (SKU)" for every row in the export. */
export async function readActiveItemNumbers(
  filePath: string,
): Promise<Map<string, string>> {
  if (filePath.toLowerCase().endsWith('.csv')) {
    return readActiveItemNumbersFromCsv(filePath);
  }
  return readActiveItemNumbersFromXlsx(filePath);
}
