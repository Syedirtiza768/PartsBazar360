import { Module } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';
import { PrismaService } from '../../prisma.service';
import { FebestWebsiteService } from './febest-website.service';

@Module({
  providers: [OpenSearchService, PrismaService, FebestWebsiteService],
  controllers: [SearchController],
  exports: [OpenSearchService, FebestWebsiteService],
})
export class SearchModule {}
