import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GarageService } from './garage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('garage')
@UseGuards(JwtAuthGuard)
export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  @Get()
  async getMyGarage(@CurrentUser() user: AuthenticatedUser) {
    return this.garageService.getMyGarage(user.userId);
  }

  @Post()
  async addVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { vehicleConfigId: string; nickname?: string; vin?: string },
  ) {
    return this.garageService.addVehicleToGarage(user.userId, body);
  }

  @Delete(':id')
  async removeVehicle(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.garageService.removeVehicleFromGarage(user.userId, id);
  }
}
