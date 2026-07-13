import { Module } from '@nestjs/common';
import { GarageService } from './garage.service';
import { GarageController } from './garage.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  providers: [GarageService, PrismaService],
  controllers: [GarageController],
  exports: [GarageService],
})
export class GarageModule {}
