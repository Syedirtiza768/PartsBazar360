import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '../../prisma.service';

@Module({
  providers: [OrderService, PrismaService],
  exports: [OrderService],
})
export class OrderModule {}
