import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  RealtrackBridgeOfferQueryDto,
  RealtrackBridgeSelectionDto,
} from './realtrack-bridge.dto';
import { RealtrackBridgeService } from './realtrack-bridge.service';

@Controller('admin/realtrack-bridge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class RealtrackBridgeController {
  constructor(private readonly bridge: RealtrackBridgeService) {}

  @Get('offers')
  listOffers(@Query() query: RealtrackBridgeOfferQueryDto) {
    return this.bridge.listOffers(query);
  }

  @Post('preview')
  preview(@Body() input: RealtrackBridgeSelectionDto) {
    return this.bridge.preview(input);
  }

  @Post('transfer')
  transfer(@Body() input: RealtrackBridgeSelectionDto) {
    return this.bridge.transfer(input);
  }
}
