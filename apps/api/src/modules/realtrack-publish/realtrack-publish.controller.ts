import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RealtrackPushGuard } from './realtrack-publish.guard';
import { EndListingsDto, PushListingsDto } from './realtrack-publish.dto';
import { RealtrackPublishService } from './realtrack-publish.service';

/**
 * Inbound publishing endpoint for RealTrack ("Publish to PartsBazar360").
 * Public route: `/api/integrations/realtrack/listings` (nginx strips `/api`).
 * Machine-to-machine only — see RealtrackPushGuard.
 */
@Controller('integrations/realtrack/listings')
@UseGuards(RealtrackPushGuard)
export class RealtrackPublishController {
  constructor(private readonly publishing: RealtrackPublishService) {}

  /** Verifies the key and, when `storeId` is given, that a seller is mapped. */
  @Get('health')
  health(@Query('storeId') storeId?: string) {
    return this.publishing.health(storeId?.trim() || undefined);
  }

  /** Upsert listings. Accepted work is queued; poll `status` for the outcome. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  publish(@Body() dto: PushListingsDto) {
    return this.publishing.publish(dto);
  }

  /** Take listings off sale. */
  @Post('end')
  @HttpCode(HttpStatus.OK)
  end(@Body() dto: EndListingsDto) {
    return this.publishing.end(dto);
  }

  @Get(':storeId/:sourceListingId')
  status(
    @Param('storeId') storeId: string,
    @Param('sourceListingId') sourceListingId: string,
  ) {
    return this.publishing.status(storeId, sourceListingId);
  }
}
