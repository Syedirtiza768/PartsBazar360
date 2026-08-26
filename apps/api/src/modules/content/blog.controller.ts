import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ContentService } from './content.service';
import type { BlogPostInput } from './content.service';

@Controller('blog')
export class BlogController {
  constructor(private readonly content: ContentService) {}

  @Get('posts')
  getPublishedPosts() {
    return this.content.listPublishedPosts();
  }

  @Get('posts/:slug')
  getPublishedPost(@Param('slug') slug: string) {
    return this.content.getPublishedPost(slug);
  }
}

@Controller('admin/blog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminBlogController {
  constructor(private readonly content: ContentService) {}

  @Get('posts')
  listPosts() {
    return this.content.listAdminPosts();
  }

  @Get('posts/:id')
  getPost(@Param('id') id: string) {
    return this.content.getAdminPost(id);
  }

  @Post('posts')
  createPost(@Body() body: BlogPostInput) {
    return this.content.createPost(body);
  }

  @Patch('posts/:id')
  updatePost(@Param('id') id: string, @Body() body: BlogPostInput) {
    return this.content.updatePost(id, body);
  }

  @Delete('posts/:id')
  deletePost(@Param('id') id: string) {
    return this.content.deletePost(id);
  }
}
