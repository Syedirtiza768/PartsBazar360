/**
 * Versioned search API (brief §14).
 *
 * Mounted at `/v1/search`; nginx strips the `/api/` prefix, so the public URL
 * is `https://partsbazar360.com/api/v1/search`.
 *
 * Added alongside the existing `/search/parts` controller rather than
 * replacing it, so the current buyer app keeps working untouched while the new
 * path is validated.
 */

import { Controller, Get, Header, Query } from '@nestjs/common';
import { SearchQueryDto } from './search-query.dto';
import { SearchV1Service, type SearchV1Response } from './search-v1.service';

@Controller('v1/search')
export class SearchV1Controller {
  constructor(private readonly searchService: SearchV1Service) {}

  /**
   * Main search. Every parameter is validated by SearchQueryDto; anything
   * unrecognised is stripped by the global ValidationPipe.
   */
  @Get()
  // Anonymous catalogue search is safe to cache briefly and shared-cacheable.
  // No user-specific data is present in the response.
  @Header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60')
  async search(@Query() dto: SearchQueryDto): Promise<SearchV1Response> {
    return this.searchService.search(dto);
  }
}
