import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SearchModule } from '../search/search.module';
import { RealtrackPublishController } from './realtrack-publish.controller';
import { RealtrackPushGuard } from './realtrack-publish.guard';
import { RealtrackPublishService } from './realtrack-publish.service';

@Module({
  imports: [SearchModule, BullModule.registerQueue({ name: 'ingestion' })],
  controllers: [RealtrackPublishController],
  providers: [RealtrackPublishService, RealtrackPushGuard],
})
export class RealtrackPublishModule {}
