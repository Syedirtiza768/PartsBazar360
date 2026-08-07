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

  async reserveStock(
    cartId: string,
    offerId: string,
    quantity: number,
    availableQuantity = Number.MAX_SAFE_INTEGER,
  ): Promise<boolean> {
    const lockKey = `stock_lock:${offerId}:${cartId}`;
    const totalKey = `stock_reserved:${offerId}`;
    const result = await this.redisClient.eval(
      `
        local existing = redis.call('GET', KEYS[1])
        if existing then
          if tonumber(existing) >= tonumber(ARGV[1]) then return 1 end
          return 0
        end
        local reserved = tonumber(redis.call('GET', KEYS[2]) or '0')
        if reserved + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 0 end
        redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
        redis.call('INCRBY', KEYS[2], ARGV[1])
        redis.call('EXPIRE', KEYS[2], ARGV[3])
        return 1
      `,
      2,
      lockKey,
      totalKey,
      quantity,
      availableQuantity,
      this.LOCK_TTL_SECONDS,
    );

    if (Number(result) === 1) {
      this.logger.log(
        `Reserved ${quantity} of offer ${offerId} for cart ${cartId}`,
      );
      return true;
    }

    this.logger.warn(`Failed to reserve stock for offer ${offerId}`);
    return false;
  }

  async releaseStock(cartId: string, offerId: string): Promise<void> {
    const lockKey = `stock_lock:${offerId}:${cartId}`;
    const totalKey = `stock_reserved:${offerId}`;
    await this.redisClient.eval(
      `
        local quantity = tonumber(redis.call('GET', KEYS[1]) or '0')
        if quantity > 0 then
          redis.call('DEL', KEYS[1])
          local remaining = tonumber(redis.call('DECRBY', KEYS[2], quantity) or '0')
          if remaining <= 0 then redis.call('DEL', KEYS[2]) end
        end
        return quantity
      `,
      2,
      lockKey,
      totalKey,
    );
    this.logger.log(
      `Released stock lock for offer ${offerId} in cart ${cartId}`,
    );
  }
}
