import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AdminListingQueryDto,
  CreateAdminListingDto,
  UpdateAdminListingDto,
} from './admin-listings.dto';
import { AdminListingsService } from './admin-listings.service';
import {
  detectImageExtension,
  LISTING_IMAGE_MAX_BYTES,
  saveListingImage,
} from './listing-image-store';

const MAX_FILES_PER_UPLOAD = 8;

@Controller('admin/listings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminListingsController {
  constructor(private readonly listings: AdminListingsService) {}

  @Get()
  list(@Query() query: AdminListingQueryDto) {
    return this.listings.list(query);
  }

  @Post()
  create(
    @Body() body: CreateAdminListingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.listings.create(body, user?.userId);
  }

  @Patch(':offerId')
  update(
    @Param('offerId') offerId: string,
    @Body() body: UpdateAdminListingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.listings.update(offerId, body, user?.userId);
  }

  @Post('images')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
      limits: {
        fileSize: LISTING_IMAGE_MAX_BYTES,
        files: MAX_FILES_PER_UPLOAD,
      },
    }),
  )
  async uploadImages(
    @UploadedFiles() files: Array<{ buffer: Buffer; originalname: string }>,
  ) {
    if (!files?.length)
      throw new BadRequestException('Choose at least one photo');
    const typed = files.map((file) => {
      const ext = detectImageExtension(file.buffer);
      if (!ext) {
        throw new BadRequestException(
          `${file.originalname} is not a JPEG, PNG or WebP image`,
        );
      }
      return { buffer: file.buffer, ext };
    });
    const saved: Array<{ file: string; url: string }> = [];
    for (const file of typed)
      saved.push(await saveListingImage(file.buffer, file.ext));
    return { urls: saved.map((image) => image.url) };
  }
}
