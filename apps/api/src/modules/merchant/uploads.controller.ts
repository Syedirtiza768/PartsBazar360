import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
  ) {
    if (!file) throw new BadRequestException('file is required');
    const name = file.originalname.toLowerCase();
    if (!name.endsWith('.csv') && file.mimetype !== 'text/csv') {
      throw new BadRequestException('CSV uploads are supported in this MVP pipeline');
    }
    return this.uploads.processUpload(sellerId, file.originalname, file.buffer, {
      defaultPartSource,
      defaultQualityTier,
    });
  }

  @Patch('rows/:rowId/review')
  async reviewRow(
    @Param('rowId') rowId: string,
    @Body() body: { status: string; offerStatus?: string; notes?: string },
  ) {
    return this.uploads.reviewRow(rowId, body);
  }
}
