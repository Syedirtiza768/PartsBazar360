import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // rawBody required so Stripe webhook signatures can be verified
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.enableShutdownHooks();

  // Ensure the shared Prisma pool disconnects on SIGTERM (ECS/EC2/docker stop).
  const prisma = app.get(PrismaService);
  prisma.enableShutdownHooks(app);

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on port ${port}`);
}
bootstrap();
