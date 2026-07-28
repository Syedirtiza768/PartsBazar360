import { Controller, Get, Param, Header } from '@nestjs/common';
import { VehicleService } from './vehicle.service';

@Controller('vehicles')
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Get('makes')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  async getMakes() {
    return this.vehicleService.getMakes();
  }

  @Get('makes/:makeId/models')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  async getModels(@Param('makeId') makeId: string) {
    return this.vehicleService.getModelsByMake(makeId);
  }

  @Get('models/:modelId/generations')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  async getGenerations(@Param('modelId') modelId: string) {
    return this.vehicleService.getGenerationsByModel(modelId);
  }

  @Get('generations/:generationId/configurations')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  async getConfigurations(@Param('generationId') generationId: string) {
    return this.vehicleService.getConfigurationsByGeneration(generationId);
  }
}
