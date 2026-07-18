import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FitmentCheckService } from './fitment-check.service';

@Controller('fitment')
export class FitmentController {
  constructor(private readonly fitmentCheck: FitmentCheckService) {}

  @Get('check')
  async checkGet(@Query('partId') partId: string, @Query('vehicleConfigId') vehicleConfigId?: string) {
    return this.fitmentCheck.check(partId, vehicleConfigId);
  }

  @Post('check')
  async checkPost(@Body() body: { partId: string; vehicleConfigId?: string }) {
    return this.fitmentCheck.check(body.partId, body.vehicleConfigId);
  }

  @Get('parts/:partId')
  async checkPart(@Param('partId') partId: string, @Query('vehicleConfigId') vehicleConfigId?: string) {
    return this.fitmentCheck.check(partId, vehicleConfigId);
  }
}
