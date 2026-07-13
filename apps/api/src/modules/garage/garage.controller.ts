import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { GarageService } from './garage.service';

@Controller('garage')
export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  // Mocking userId for now since we haven't implemented full Auth middleware yet
  private readonly mockUserId = '123e4567-e89b-12d3-a456-426614174000'; 

  @Get()
  async getMyGarage() {
    return this.garageService.getMyGarage(this.mockUserId);
  }

  @Post()
  async addVehicle(@Body() body: { vehicleConfigId: string, nickname?: string, vin?: string }) {
    return this.garageService.addVehicleToGarage(this.mockUserId, body);
  }

  @Delete(':id')
  async removeVehicle(@Param('id') id: string) {
    return this.garageService.removeVehicleFromGarage(this.mockUserId, id);
  }
}
