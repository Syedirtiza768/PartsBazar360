import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);
  private redisClient: Redis;

  // Recommended TTL: 15 minutes = 900 seconds
  private readonly LOCK_TTL_SECONDS = 900; 

  constructor() {
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  async reserveStock(cartId: string, offerId: string, quantity: number): Promise<boolean> {
    const lockKey = `stock_lock:${offerId}:${cartId}`;
    
    // We attempt to set the lock. In a real highly-concurrent environment,
    // we would check the existing stock minus locked stock before granting this lock.
    // For MVP, we will assume setting the lock represents our intent to hold.
    const result = await this.redisClient.set(lockKey, quantity, 'EX', this.LOCK_TTL_SECONDS, 'NX');
    
    if (result === 'OK') {
      this.logger.log(`Reserved ${quantity} of offer ${offerId} for cart ${cartId}`);
      return true;
    }
    
    this.logger.warn(`Failed to reserve stock for offer ${offerId}`);
    return false;
  }

  async releaseStock(cartId: string, offerId: string): Promise<void> {
    const lockKey = `stock_lock:${offerId}:${cartId}`;
    await this.redisClient.del(lockKey);
    this.logger.log(`Released stock lock for offer ${offerId} in cart ${cartId}`);
  }
}
