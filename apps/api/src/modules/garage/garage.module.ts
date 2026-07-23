import { Module } from '@nestjs/common';
import { GarageService } from './garage.service';
import { GarageController } from './garage.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [GarageService],
  controllers: [GarageController],
  exports: [GarageService],
})
export class GarageModule {}
