import { Workbook } from 'exceljs';
import { SpreadsheetParserService } from './spreadsheet-parser.service';

describe('SpreadsheetParserService Dynatrade', () => {
  const service = new SpreadsheetParserService();

  it('detects Dynatrade stock list headers and maps brand code + MPN', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['BRAND', '', 'Original Part No.', 'Manufacturer No.', 'Part Description', 'STOCK', 'UNIT PRICE ']);
    sheet.addRow(['', 'ANC', '5W40/SN/CF-12X1L', '57428-1L', 'ENGINE OIL', 2, 109.76]);
    sheet.addRow(['', 'AE', '030109611T', 'V94405', 'EXHAUST VALVE', 2, 6.4386]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const [parsed] = await service.parse('Dynatrade - STOCK LIST.xlsx', buffer);
    expect(parsed.template).toBe('DYNATRADE_STOCK');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].raw.brand).toBe('ANC');
    expect(parsed.rows[0].raw.manufacturerPartNumber).toBe('57428-1L');
    expect(parsed.rows[0].raw.oemReferences).toBe('5W40/SN/CF-12X1L');
    expect(parsed.rows[0].raw.quantity).toBe('2');
    expect(parsed.rows[0].raw.price).toBe('109.76');
    expect(parsed.suggestedDefaults.currency).toBe('AED');
  });
});
