import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class VehicleService {
  constructor(private prisma: PrismaService) {}

  async getMakes() {
    return this.prisma.vehicleMake.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async getModelsByMake(makeId: string) {
    return this.prisma.vehicleModel.findMany({
      where: { makeId },
      orderBy: { name: 'asc' },
    });
  }

  async getGenerationsByModel(modelId: string) {
    return this.prisma.vehicleGeneration.findMany({
      where: { modelId },
      orderBy: { name: 'asc' },
    });
  }

  async getConfigurationsByGeneration(generationId: string) {
    return this.prisma.vehicleConfiguration.findMany({
      where: { generationId },
    });
  }
}
