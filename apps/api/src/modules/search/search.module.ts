import { Module } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  providers: [OpenSearchService, PrismaService],
  controllers: [SearchController],
  exports: [OpenSearchService],
})
export class SearchModule {}
