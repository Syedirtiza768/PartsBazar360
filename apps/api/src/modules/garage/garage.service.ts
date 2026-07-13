import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class GarageService {
  constructor(private prisma: PrismaService) {}

  async getMyGarage(userId: string) {
    return this.prisma.userVehicle.findMany({
      where: { userId },
      include: {
        vehicleConfig: {
          include: {
            generation: {
              include: {
                model: {
                  include: {
                    make: true
                  }
                }
              }
            }
          }
        }
      }
    });
  }

  async addVehicleToGarage(userId: string, data: { vehicleConfigId: string, nickname?: string, vin?: string }) {
    const config = await this.prisma.vehicleConfiguration.findUnique({
      where: { id: data.vehicleConfigId }
    });

    if (!config) {
      throw new NotFoundException(`Vehicle Configuration ${data.vehicleConfigId} not found`);
    }

    return this.prisma.userVehicle.create({
      data: {
        userId,
        vehicleConfigId: data.vehicleConfigId,
        nickname: data.nickname,
        vin: data.vin
      }
    });
  }

  async removeVehicleFromGarage(userId: string, userVehicleId: string) {
    const userVehicle = await this.prisma.userVehicle.findUnique({
      where: { id: userVehicleId }
    });

    if (!userVehicle || userVehicle.userId !== userId) {
      throw new NotFoundException(`User Vehicle ${userVehicleId} not found in your garage`);
    }

    return this.prisma.userVehicle.delete({
      where: { id: userVehicleId }
    });
  }
}
