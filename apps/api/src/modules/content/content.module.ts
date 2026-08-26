import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminBlogController, BlogController } from './blog.controller';
import { ContentService } from './content.service';
import { PolicyController } from './policy.controller';

@Module({
  imports: [AuthModule],
  controllers: [BlogController, AdminBlogController, PolicyController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
