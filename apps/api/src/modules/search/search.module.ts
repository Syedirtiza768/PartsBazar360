import { Module } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';

@Module({
  providers: [OpenSearchService],
  controllers: [SearchController],
  exports: [OpenSearchService],
})
export class SearchModule {}
