import { Module } from '@nestjs/common';
import { VehicleService } from './vehicle.service';
import { VehicleController } from './vehicle.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  providers: [VehicleService, PrismaService],
  controllers: [VehicleController],
  exports: [VehicleService],
})
export class VehicleModule {}
