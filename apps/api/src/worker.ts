import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

/**
 * Background worker process — same Nest module graph as the API, but no HTTP
 * listener. BullMQ @Processor handlers register on bootstrap when
 * RUN_INGESTION_WORKER is not '0'.
 */
async function bootstrap() {
  const logger = new Logger('Worker');
  process.env.RUN_INGESTION_WORKER = process.env.RUN_INGESTION_WORKER ?? '1';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — closing worker`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep reference so the shared pool stays initialized for processors.
  void prisma;

  logger.log('Ingestion worker ready (BullMQ concurrency via @Processor)');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
