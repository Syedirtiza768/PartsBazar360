import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import type { Response } from 'express';
import {
  LISTING_IMAGE_FILE_RE,
  listingImageContentType,
  listingImageDir,
} from './listing-image-store';

/** Public read route for admin-uploaded listing photos. */
@Controller('listing-images')
export class ListingImagesController {
  @Get(':file')
  async serve(
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!LISTING_IMAGE_FILE_RE.test(file)) {
      throw new NotFoundException();
    }
    const path = join(listingImageDir(), file);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException();

    res.set({
      'Content-Type': listingImageContentType(file),
      'Content-Length': String(info.size),
      // File names are random UUIDs and never rewritten.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(createReadStream(path));
  }
}
