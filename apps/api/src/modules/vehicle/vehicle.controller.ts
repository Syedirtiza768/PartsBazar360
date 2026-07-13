import { Controller, Get, Param } from '@nestjs/common';
import { VehicleService } from './vehicle.service';

@Controller('vehicles')
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Get('makes')
  async getMakes() {
    return this.vehicleService.getMakes();
  }

  @Get('makes/:makeId/models')
  async getModels(@Param('makeId') makeId: string) {
    return this.vehicleService.getModelsByMake(makeId);
  }

  @Get('models/:modelId/generations')
  async getGenerations(@Param('modelId') modelId: string) {
    return this.vehicleService.getGenerationsByModel(modelId);
  }

  @Get('generations/:generationId/configurations')
  async getConfigurations(@Param('generationId') generationId: string) {
    return this.vehicleService.getConfigurationsByGeneration(generationId);
  }
}
