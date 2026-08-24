import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  RealtrackBridgeOfferQueryDto,
  RealtrackBridgeSelectionDto,
} from './realtrack-bridge.dto';
import { RealtrackBridgeService } from './realtrack-bridge.service';

@Controller('admin/realtrack-bridge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class RealtrackBridgeController {
  constructor(
    private readonly bridge: RealtrackBridgeService,
    @InjectQueue('realtrack-bridge')
    private readonly transferQueue: Queue,
  ) {}

  @Get('offers')
  listOffers(@Query() query: RealtrackBridgeOfferQueryDto) {
    return this.bridge.listOffers(query);
  }

  @Post('preview')
  preview(@Body() input: RealtrackBridgeSelectionDto) {
    return this.bridge.preview(input);
  }

  @Post('transfer')
  async transfer(@Body() input: RealtrackBridgeSelectionDto) {
    if (input.dryRun !== false) return this.bridge.transfer(input);
    if (input.publishToEbay && !input.storeIds?.length) {
      throw new BadRequestException(
        'storeIds are required when publishToEbay is enabled',
      );
    }
    const job = await this.transferQueue.add(
      'transfer',
      { input },
      {
        attempts: 1,
        removeOnComplete: { age: 24 * 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 100 },
      },
    );
    return {
      dryRun: false,
      status: 'queued',
      jobId: String(job.id),
      selected:
        input.selectAll === true
          ? Math.min(input.maxItems || 5000, 5000)
          : input.offerIds?.length || 0,
      message:
        'Transfer queued. RealTrack writes run in the background with rate-limit retries.',
    };
  }

  @Get('transfer/:jobId')
  async transferStatus(@Param('jobId') jobId: string) {
    const job = await this.transferQueue.getJob(jobId);
    if (!job) throw new NotFoundException('Transfer job not found');
    const state = await job.getState();
    const progress = job.progress;
    if (state === 'completed') {
      const result = (job.returnvalue || {}) as Record<string, unknown>;
      return {
        ...result,
        status: state,
        jobId: String(job.id),
        progress,
      };
    }
    return {
      status: state,
      jobId: String(job.id),
      progress,
      error: state === 'failed' ? job.failedReason : undefined,
    };
  }
}
