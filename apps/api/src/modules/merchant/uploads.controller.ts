import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MerchantUploadsService } from './uploads.service';

@Controller('merchant/uploads')
export class UploadsController {
  constructor(private readonly uploads: MerchantUploadsService) {}

  @Get()
  async listUploads(@Query('sellerId') sellerId: string) {
    return this.uploads.listJobs(sellerId);
  }

  @Get(':jobId')
  async getUpload(@Param('jobId') jobId: string) {
    return this.uploads.getJob(jobId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: any,
    @Body('sellerId') sellerId: string,
    @Body('defaultPartSource') defaultPartSource?: string,
    @Body('defaultQualityTier') defaultQualityTier?: string,
    @Body('defaultBrand') defaultBrand?: string,
    @Body('defaultCurrency') defaultCurrency?: string,
    @Body('defaultWeightUnit') defaultWeightUnit?: string,
    @Body('defaultDimensionUnit') defaultDimensionUnit?: string,
    @Body('commitMode') commitMode?: 'IMMEDIATE' | 'STAGED',
    @Body('catalogType') catalogType?: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const name = file.originalname.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      throw new BadRequestException('Upload a .csv or .xlsx seller inventory file');
    }
    return this.uploads.processUpload(sellerId, file.originalname, file.buffer, {
      defaultPartSource,
      defaultQualityTier,
      defaultBrand,
      defaultCurrency,
      defaultWeightUnit,
      defaultDimensionUnit,
      commitMode,
      catalogType,
    });
  }

  @Put(':jobId/mapping')
  async updateMapping(
    @Param('jobId') jobId: string,
    @Body() body: {
      mapping?: unknown;
      defaultBrand?: string;
      defaultCurrency?: string;
      defaultWeightUnit?: string;
      defaultDimensionUnit?: string;
      catalogType?: string;
    },
  ) {
    return this.uploads.updateMapping(jobId, body.mapping ?? {}, body);
  }

  @Post(':jobId/commit')
  async commit(@Param('jobId') jobId: string) {
    return this.uploads.commitJob(jobId);
  }

  @Get(':jobId/preview')
  async preview(@Param('jobId') jobId: string) {
    const job = await this.uploads.getJob(jobId);
    return {
      id: job.id,
      status: job.status,
      commitMode: job.commitMode,
      detection: job.detection,
      mapping: job.mapping,
      preview: job.preview,
      report: job.report,
      totals: {
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        insertedRows: job.insertedRows,
        reviewRows: job.reviewRows,
        invalidRows: job.invalidRows,
      },
      sampleRows: job.rows.slice(0, 25).map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber,
        status: row.status,
        title: row.title,
        brand: row.brand,
        suggestedPartType: row.suggestedPartType,
        classificationConfidence: row.classificationConfidence,
        matchConfidence: row.matchConfidence,
        matchCandidateId: row.matchCandidateId,
        reviewReasons: row.reviewReasons,
        message: row.message,
      })),
    };
  }

  @Patch('rows/:rowId/review')
  async reviewRow(
    @Param('rowId') rowId: string,
    @Body() body: { status: string; offerStatus?: string; notes?: string },
  ) {
    return this.uploads.reviewRow(rowId, body);
  }
}
