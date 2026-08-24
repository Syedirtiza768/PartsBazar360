import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { RealtrackBridgeController } from './realtrack-bridge.controller';
import { RealtrackClientService } from './realtrack-client.service';
import { RealtrackBridgeService } from './realtrack-bridge.service';
import { RealtrackFxService } from './realtrack-fx.service';
import { RealtrackBridgeProcessor } from './realtrack-bridge.processor';

const runWorker = process.env.RUN_INGESTION_WORKER !== '0';

@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: 'realtrack-bridge' })],
  controllers: [RealtrackBridgeController],
  providers: [
    RealtrackBridgeService,
    RealtrackClientService,
    RealtrackFxService,
    ...(runWorker ? [RealtrackBridgeProcessor] : []),
  ],
  exports: [RealtrackBridgeService],
})
export class RealtrackBridgeModule {}
