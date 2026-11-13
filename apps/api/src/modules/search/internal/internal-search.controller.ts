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
import { OptionsQueryDto } from './options/options-query.dto';
import { PortalOptionsService } from './options/portal-options.service';

const PART_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

@Controller('integrations/realtrack/search')
@UseGuards(RealtrackSearchGuard)
export class InternalSearchController {
  constructor(
    private readonly internalSearch: InternalSearchService,
    private readonly portalOptions: PortalOptionsService,
  ) {}

  /**
   * "Every sellable option": number expansion with trails, live availability
   * from Postgres and evidence-based fitment verdicts, grouped.
   */
  @Get('options')
  @Header('Cache-Control', 'private, no-store')
  options(@Query() dto: OptionsQueryDto) {
    return this.portalOptions.options(dto);
  }

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
