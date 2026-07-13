import { Controller, Get, Query } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: OpenSearchService) {}

  @Get('parts')
  async searchParts(
    @Query('vehicleConfigId') vehicleConfigId: string,
    @Query('q') query?: string,
  ) {
    if (!vehicleConfigId) {
      return { error: 'vehicleConfigId is required for fitment-first search' };
    }

    return this.searchService.searchCompatibleParts(vehicleConfigId, query);
  }
}
