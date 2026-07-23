import { Injectable, OnModuleInit, OnModuleDestroy, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Single shared Prisma client + pg pool for the whole Nest process.
 * Pool size is capped so HTTP handlers + in-process BullMQ workers cannot
 * exhaust PostgreSQL max_connections on the co-located Docker Postgres.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL!;
    const max = Math.max(2, Number(process.env.DATABASE_POOL_MAX || 10));
    const pool = new Pool({
      connectionString,
      max,
      idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_MS || 30_000),
      connectionTimeoutMillis: Number(process.env.DATABASE_POOL_CONNECT_MS || 10_000),
    });
    const adapter = new PrismaPg(pool);
    super({ adapter } as any);
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
