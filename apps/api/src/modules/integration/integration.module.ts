import { Module } from '@nestjs/common';
import { RealTrackService } from './realtrack.service';

@Module({
  providers: [RealTrackService],
  exports: [RealTrackService],
})
export class IntegrationModule {}
