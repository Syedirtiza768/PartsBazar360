/**
 * Internal search for Omni Core's Parts Search portal.
 *
 * Mounted at `/integrations/realtrack/search`; nginx strips the `/api/`
 * prefix, so the public URL is
 * `https://partsbazar360.com/api/integrations/realtrack/search`.
 *
 * Machine-to-machine only (RealtrackSearchGuard). Responses carry seller,
 * source and stock data, so they are never cacheable by shared caches.
 */

import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SearchQueryDto } from '../v1/search-query.dto';
import { RealtrackSearchGuard } from './internal-search.guard';
import { InternalSearchService } from './internal-search.service';

const PART_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

@Controller('integrations/realtrack/search')
@UseGuards(RealtrackSearchGuard)
export class InternalSearchController {
  constructor(private readonly internalSearch: InternalSearchService) {}

  @Get('health')
  @Header('Cache-Control', 'private, no-store')
  health() {
    return { ok: true, audience: 'internal' };
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  search(@Query() dto: SearchQueryDto) {
    return this.internalSearch.search(dto);
  }

  @Get('parts/:id')
  @Header('Cache-Control', 'private, no-store')
  part(@Param('id') id: string) {
    // Seeded parts use slug-like ids, so accept any short id-shaped token
    // rather than insisting on a UUID.
    if (!PART_ID_RE.test(id)) throw new BadRequestException('Invalid part id');
    return this.internalSearch.part(id);
  }
}
