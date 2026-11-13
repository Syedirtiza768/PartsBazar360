import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { enrichmentMediaDir } from '../enrichment/location-diagram';

/**
 * Admin-uploaded listing photos live on the API's persistent media volume
 * (the same `enrichment_media` volume the enrichment worker writes to), not
 * in S3: the server's AWS credentials are read-only by design.
 */
export const LISTING_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const LISTING_IMAGE_FILE_RE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function listingImageDir(): string {
  return join(enrichmentMediaDir(), 'listing-uploads');
}

export function listingImageContentType(file: string): string {
  const ext = file.split('.').pop() || '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

/** Identify the format from magic bytes; the client-declared type is not trusted. */
export function detectImageExtension(
  buffer: Buffer,
): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export async function saveListingImage(
  buffer: Buffer,
  ext: 'jpg' | 'png' | 'webp',
): Promise<{ file: string; url: string }> {
  const dir = listingImageDir();
  await mkdir(dir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  await writeFile(join(dir, file), buffer, { flag: 'wx' });
  return { file, url: `/api/listing-images/${file}` };
}
