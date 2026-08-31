import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderStatusService } from './order-status.service';
import { OrderNotificationService } from './order-notification.service';

@Module({
  providers: [OrderService, OrderStatusService, OrderNotificationService],
  exports: [OrderService, OrderStatusService, OrderNotificationService],
})
export class OrderModule {}
