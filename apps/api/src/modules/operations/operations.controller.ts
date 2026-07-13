import { Controller, Post, Param, Body, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Controller('operations')
export class OperationsController {
  private readonly logger = new Logger(OperationsController.name);

  constructor(
    @InjectQueue('ingestion') private readonly ingestionQueue: Queue,
  ) {}

  @Post('sync/realtrack/:storeId')
  async triggerRealTrackSync(@Param('storeId') storeId: string, @Body('page') page?: number) {
    this.logger.log(`Triggering manual sync for store: ${storeId}`);
    
    const job = await this.ingestionQueue.add('sync-store', {
      storeId,
      page: page || 1,
    });

    return {
      message: 'Sync job queued successfully',
      jobId: job.id,
      storeId,
    };
  }
}
