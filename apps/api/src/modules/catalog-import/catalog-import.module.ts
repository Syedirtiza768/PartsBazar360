import { Module } from '@nestjs/common';
import { SpreadsheetParserService } from './spreadsheet-parser.service';

@Module({
  providers: [SpreadsheetParserService],
  exports: [SpreadsheetParserService],
})
export class CatalogImportModule {}
