import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * One PrismaService for the entire API process. Feature modules must import
 * nothing extra — they inject PrismaService after AppModule imports this.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
