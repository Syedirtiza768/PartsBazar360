import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OperationsController } from './operations.controller';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ingestion',
    }),
  ],
  controllers: [OperationsController, SupportController],
  providers: [PrismaService, SupportService],
})
export class OperationsModule {}
