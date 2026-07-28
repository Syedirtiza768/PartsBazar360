import { Module } from '@nestjs/common';
import { ListingPipelineService } from './listing-pipeline.service';
import { CostAnalysisService } from './cost-analysis.service';
import { ListingPipelineController } from './listing-pipeline.controller';

@Module({
  providers: [ListingPipelineService, CostAnalysisService],
  controllers: [ListingPipelineController],
  exports: [ListingPipelineService, CostAnalysisService],
})
export class ListingPipelineModule {}
