import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SpreadsheetParserService } from './spreadsheet-parser.service';
import { CatalogAuditService } from './catalog-audit.service';
import { CatalogMatchService } from './catalog-match.service';
import { FitmentCheckService } from './fitment-check.service';
import { ReviewTaskService } from './review-task.service';
import { FitmentController } from './fitment.controller';
import { AdminCatalogController } from './admin-catalog.controller';

@Module({
  controllers: [FitmentController, AdminCatalogController],
  providers: [
    PrismaService,
    SpreadsheetParserService,
    CatalogAuditService,
    CatalogMatchService,
    FitmentCheckService,
    ReviewTaskService,
  ],
  exports: [
    SpreadsheetParserService,
    CatalogAuditService,
    CatalogMatchService,
    FitmentCheckService,
    ReviewTaskService,
  ],
})
export class CatalogImportModule {}
