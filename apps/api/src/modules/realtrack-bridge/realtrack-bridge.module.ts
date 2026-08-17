import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtrackBridgeController } from './realtrack-bridge.controller';
import { RealtrackClientService } from './realtrack-client.service';
import { RealtrackBridgeService } from './realtrack-bridge.service';

@Module({
  imports: [AuthModule],
  controllers: [RealtrackBridgeController],
  providers: [RealtrackBridgeService, RealtrackClientService],
})
export class RealtrackBridgeModule {}
