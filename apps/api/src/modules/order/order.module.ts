import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderStatusService } from './order-status.service';

@Module({
  providers: [OrderService, OrderStatusService],
  exports: [OrderService, OrderStatusService],
})
export class OrderModule {}
